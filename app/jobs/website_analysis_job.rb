require "net/http"
require "resolv"

# Crawls a company's website via Cloudflare Browser Rendering and uses AI
# to generate a structured company summary.
class WebsiteAnalysisJob < ApplicationJob
  queue_as :default

  MAX_TOTAL_TEXT = 12000
  CRAWL_POLL_INTERVAL = 3 # seconds
  CRAWL_TIMEOUT = 60 # seconds

  def perform(organization_id)
    org = Organization.find_by(id: organization_id)
    return unless org&.website_url.present?

    org.update!(website_analysis_error: nil)

    detected_provider = detect_email_provider(org.website_url)
    org.update!(detected_email_provider: detected_provider) if detected_provider.present?

    pages = crawl_site(org.website_url)

    total_text = pages.sum { |p| p[:text].to_s.length }
    if total_text < 50
      error_msg = "Could not fetch content from #{org.website_url}. The site may be unreachable or blocking crawlers."
      Rails.logger.error("[WebsiteAnalysisJob] #{error_msg} (org=#{org.id})")
      org.update!(website_analysis_error: error_msg)
      return
    end

    raw = generate_summary(org.name, org.website_url, pages)
    raw = raw.strip.gsub(/\A```json\s*/, "").gsub(/\s*```\z/, "")
    parsed = JSON.parse(raw)
    org.update!(company_summary: parsed.to_json, website_analysis_error: nil)
  rescue => e
    Rails.logger.error("[WebsiteAnalysisJob] Error for org=#{organization_id}: #{e.class} — #{e.message}\n#{e.backtrace&.first(5)&.join("\n")}")
    org = Organization.find_by(id: organization_id)
    org&.update(website_analysis_error: "Analysis failed: #{e.message.truncate(200)}")
  end

  private

  # ── Email provider detection via MX records ────────────────────────────

  # Maps an MX hostname suffix to the human-readable email provider name.
  EMAIL_PROVIDER_MX_PATTERNS = {
    "google.com" => "Google Workspace",
    "googlemail.com" => "Google Workspace",
    "outlook.com" => "Microsoft 365",
    "protection.outlook.com" => "Microsoft 365",
    "office365.com" => "Microsoft 365",
    "zoho.com" => "Zoho Mail",
    "zohomail.com" => "Zoho Mail",
    "icloud.com" => "Apple iCloud",
    "fastmail.com" => "Fastmail",
    "messagingengine.com" => "Fastmail",
    "protonmail.ch" => "Proton Mail",
    "proton.me" => "Proton Mail",
    "amazonses.com" => "Amazon SES",
    "mailgun.org" => "Mailgun",
    "sendgrid.net" => "SendGrid",
    "yandex.net" => "Yandex Mail",
    "mail.ru" => "Mail.ru",
    "mimecast.com" => "Mimecast",
    "pphosted.com" => "Proofpoint",
  }.freeze

  def detect_email_provider(url)
    host = URI.parse(url).host.to_s.downcase.sub(/\Awww\./, "")
    return nil if host.blank?

    exchanges = Resolv::DNS.open(timeout: 4) do |dns|
      dns.getresources(host, Resolv::DNS::Resource::IN::MX).map { |r| r.exchange.to_s.downcase }
    end
    return nil if exchanges.empty?

    EMAIL_PROVIDER_MX_PATTERNS.each do |suffix, provider|
      return provider if exchanges.any? { |ex| ex.end_with?(suffix) }
    end

    "Custom (#{exchanges.first})"
  rescue => e
    Rails.logger.warn("[WebsiteAnalysisJob] MX lookup failed for #{url}: #{e.message}")
    nil
  end

  # ── Crawling via Cloudflare Browser Rendering ──────────────────────────

  def crawl_site(root_url)
    cf_api_key = ENV["CLOUDFLARE_API_KEY"]
    cf_account_id = ENV["CLOUDFLARE_ACCOUNT_ID"]

    if cf_api_key.present? && cf_account_id.present?
      Rails.logger.info("[WebsiteAnalysisJob] Using Cloudflare crawl for #{root_url}")
      cloudflare_crawl(root_url, cf_api_key, cf_account_id)
    else
      Rails.logger.info("[WebsiteAnalysisJob] Cloudflare not configured, using direct HTTP crawl for #{root_url}")
      direct_crawl(root_url)
    end
  end

  def cloudflare_crawl(root_url, api_key, account_id)
    base = "https://api.cloudflare.com/client/v4/accounts/#{account_id}/browser-rendering/crawl"

    # 1. Start crawl job
    job_id = cf_start_crawl(base, api_key, root_url)
    Rails.logger.info("[WebsiteAnalysisJob] Cloudflare crawl started: job=#{job_id}")

    # 2. Poll until done
    elapsed = 0
    status = nil
    loop do
      sleep(CRAWL_POLL_INTERVAL)
      elapsed += CRAWL_POLL_INTERVAL
      status = cf_poll_status(base, api_key, job_id)
      Rails.logger.info("[WebsiteAnalysisJob] Cloudflare crawl status=#{status} elapsed=#{elapsed}s job=#{job_id}")
      break if status != "running" || elapsed >= CRAWL_TIMEOUT
    end

    if status == "running"
      Rails.logger.warn("[WebsiteAnalysisJob] Cloudflare crawl timed out after #{CRAWL_TIMEOUT}s, fetching partial results")
    end

    # 3. Fetch results
    records = cf_fetch_results(base, api_key, job_id)
    Rails.logger.info("[WebsiteAnalysisJob] Cloudflare crawl returned #{records.size} pages")

    pages = records.filter_map do |record|
      next unless record["status"] == "completed"
      text = record["markdown"].presence || record["html"].to_s
      next if text.length < 30
      {
        url: record.dig("metadata", "url") || record["url"],
        text: text.truncate(3000)
      }
    end

    # Also detect tech from any HTML we got back
    first_html = records.find { |r| r["html"].present? }&.dig("html")
    if first_html
      hints = detect_tech_hints(first_html)
      pages << { url: "TECH_SIGNALS", text: hints } if hints.present?
    end

    pages.presence || [{ url: root_url, text: "(crawl returned no content)" }]
  end

  def cf_start_crawl(base, api_key, url)
    uri = URI.parse(base)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.read_timeout = 15

    request = Net::HTTP::Post.new(uri.path)
    request["Content-Type"] = "application/json"
    request["Authorization"] = "Bearer #{api_key}"
    request.body = {
      url: url,
      limit: 10,
      depth: 2,
      formats: ["markdown", "html"],
      render: true,
      rejectResourceTypes: ["image", "font", "media"]
    }.to_json

    response = http.request(request)
    result = JSON.parse(response.body)

    unless response.is_a?(Net::HTTPSuccess) && result["success"]
      error = result.dig("errors", 0, "message") || result.to_json.truncate(200)
      raise "Cloudflare crawl start failed (#{response.code}): #{error}"
    end

    result["result"]
  end

  def cf_poll_status(base, api_key, job_id)
    uri = URI.parse("#{base}/#{job_id}?limit=1")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.read_timeout = 10

    request = Net::HTTP::Get.new(uri.request_uri)
    request["Authorization"] = "Bearer #{api_key}"

    response = http.request(request)
    result = JSON.parse(response.body)
    result.dig("result", "status") || "errored"
  rescue => e
    Rails.logger.warn("[WebsiteAnalysisJob] Cloudflare poll failed: #{e.message}")
    "running" # keep polling
  end

  def cf_fetch_results(base, api_key, job_id)
    all_records = []
    cursor = 0
    limit = 10

    loop do
      uri = URI.parse("#{base}/#{job_id}?limit=#{limit}&cursor=#{cursor}")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.read_timeout = 10

      request = Net::HTTP::Get.new(uri.request_uri)
      request["Authorization"] = "Bearer #{api_key}"

      response = http.request(request)
      result = JSON.parse(response.body)
      records = result.dig("result", "records") || []
      all_records.concat(records)

      # No more pages
      break if records.size < limit
      cursor += records.size
    end

    all_records
  end

  # ── Fallback: Direct HTTP crawl ────────────────────────────────────────

  def direct_crawl(root_url)
    pages = []

    homepage_html = fetch_page(root_url)
    return [{ url: root_url, text: "(could not fetch website)" }] if homepage_html.blank?

    homepage_text = extract_text(homepage_html)
    tech_hints = detect_tech_hints(homepage_html)
    pages << { url: root_url, text: homepage_text.truncate(3000) }

    links = extract_internal_links(homepage_html, root_url)
    priority_links = prioritize_links(links)

    priority_links.first(4).each do |link|
      html = fetch_page(link)
      next if html.blank?
      text = extract_text(html)
      next if text.length < 50
      pages << { url: link, text: text.truncate(3000) }
    end

    pages << { url: "TECH_SIGNALS", text: tech_hints } if tech_hints.present?
    pages
  end

  def fetch_page(url, redirects = 0)
    return nil if redirects > 5
    uri = URI.parse(url)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"
    http.open_timeout = 8
    http.read_timeout = 10

    request = Net::HTTP::Get.new(uri.request_uri)
    request["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    request["Accept"] = "text/html,application/xhtml+xml"
    response = http.request(request)

    case response
    when Net::HTTPRedirection
      location = response["location"]
      location = URI.join(url, location).to_s if location && !location.start_with?("http")
      fetch_page(location, redirects + 1)
    when Net::HTTPSuccess
      response.body.to_s.force_encoding("UTF-8")
    end
  rescue => e
    Rails.logger.warn("[WebsiteAnalysisJob] fetch failed for #{url}: #{e.message}")
    nil
  end

  def extract_text(html)
    text = html.dup
    text.gsub!(/<(script|style|nav|footer|header|noscript|iframe|svg)[^>]*>.*?<\/\1>/mi, " ")
    text.gsub!(/<!--.*?-->/m, " ")
    meta_desc = html.scan(/<meta[^>]*(?:name=["']description["']|property=["']og:description["'])[^>]*content=["']([^"']+)["']/i).flatten.first
    meta_title = html.scan(/<title[^>]*>([^<]+)<\/title>/i).flatten.first&.strip
    text.gsub!(/<[^>]+>/, " ")
    text.gsub!(/&nbsp;/i, " ")
    text.gsub!(/&amp;/i, "&")
    text.gsub!(/&lt;/i, "<")
    text.gsub!(/&gt;/i, ">")
    text.gsub!(/&quot;/i, '"')
    text.gsub!(/&#\d+;/, " ")
    text.gsub!(/&[a-z]+;/i, " ")
    text.gsub!(/\s+/, " ")
    text.strip!

    parts = []
    parts << "Page title: #{meta_title}" if meta_title.present?
    parts << "Description: #{meta_desc}" if meta_desc.present?
    parts << text
    parts.join("\n")
  end

  def extract_internal_links(html, root_url)
    root_uri = URI.parse(root_url)
    links = html.scan(/<a[^>]+href=["']([^"'#]+)["']/i).flatten.uniq
    links.filter_map do |href|
      href = href.strip
      next if href.start_with?("mailto:", "tel:", "javascript:")
      full_url = if href.start_with?("http")
        href
      elsif href.start_with?("/")
        "#{root_uri.scheme}://#{root_uri.host}#{href}"
      else
        "#{root_url.chomp('/')}/#{href}"
      end
      uri = URI.parse(full_url)
      next unless uri.host == root_uri.host
      "#{uri.scheme}://#{uri.host}#{uri.path}".chomp("/")
    rescue URI::InvalidURIError
      nil
    end.uniq
  end

  PRIORITY_PATTERNS = [/\/about/i, /\/company/i, /\/product/i, /\/service/i, /\/solution/i,
    /\/platform/i, /\/pricing/i, /\/team/i, /\/features/i, /\/how-it-works/i].freeze

  def prioritize_links(links)
    scored = links.filter_map do |link|
      path = URI.parse(link).path.to_s.downcase
      next if path.match?(/\/(blog|news|press|careers|jobs|login|signup|privacy|terms|legal|contact|faq|support|help|docs|api|sitemap|feed|rss)/i)
      next if path.match?(/\.(pdf|png|jpg|svg|css|js|xml|json|zip|ico)$/i)
      next if path.count("/") > 3
      score = PRIORITY_PATTERNS.count { |pat| path.match?(pat) }
      score += 1 if path.count("/") <= 2
      [link, score]
    end
    scored.sort_by { |_, s| -s }.map(&:first)
  end

  # ── Tech detection from raw HTML ──────────────────────────────────────

  def detect_tech_hints(html)
    hints = []
    generator = html.scan(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i).flatten
    hints += generator.map { |g| "Generator: #{g}" }
    hints << "Next.js" if html.include?("_next/") || html.include?("__NEXT_DATA__")
    hints << "React" if html.include?("react") && html.include?("__REACT")
    hints << "Vue.js" if html.include?("__vue") || html.include?("vue.min.js")
    hints << "Angular" if html.include?("ng-version") || html.include?("angular")
    hints << "WordPress" if html.include?("wp-content") || html.include?("wp-includes")
    hints << "Shopify" if html.include?("cdn.shopify.com") || html.include?("Shopify.theme")
    hints << "Webflow" if html.include?("webflow.com") || html.include?("wf-page")
    hints << "Wix" if html.include?("wix.com") || html.include?("wixstatic")
    hints << "Squarespace" if html.include?("squarespace.com") || html.include?("sqsp")
    hints << "HubSpot" if html.include?("hubspot") || html.include?("hs-scripts")
    hints << "Gatsby" if html.include?("gatsby")
    hints << "Nuxt" if html.include?("__nuxt") || html.include?("_nuxt/")
    hints << "Svelte/SvelteKit" if html.include?("svelte") || html.include?("__sveltekit")
    hints << "Rails" if html.include?("csrf-token") && html.include?("csrf-param")
    hints << "Laravel" if html.include?("laravel")
    hints << "Django" if html.include?("csrfmiddlewaretoken")
    hints << "Tailwind CSS" if html.include?("tailwindcss")
    hints << "Bootstrap" if html.include?("bootstrap")
    hints << "Google Analytics" if html.include?("google-analytics") || html.include?("gtag")
    hints << "Segment" if html.include?("segment.com") || html.include?("analytics.js")
    hints << "Intercom" if html.include?("intercom")
    hints << "Stripe" if html.include?("stripe.com") || html.include?("js.stripe")
    hints << "Cloudflare" if html.include?("cloudflare")
    hints << "Vercel" if html.include?("vercel")
    hints << "Netlify" if html.include?("netlify")
    hints << "AWS" if html.include?("amazonaws.com")
    hints.uniq.join(", ")
  end

  # ── AI summary generation ──────────────────────────────────────────────

  def generate_summary(org_name, url, pages)
    api_key = ENV["ANTHROPIC_API_KEY"]
    raise "ANTHROPIC_API_KEY is not set. Add it to your .env file." unless api_key.present?

    content_block = pages.map do |page|
      "--- #{page[:url]} ---\n#{page[:text]}"
    end.join("\n\n").truncate(MAX_TOTAL_TEXT)

    uri = URI.parse("https://api.anthropic.com/v1/messages")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.read_timeout = 30

    request = Net::HTTP::Post.new(uri.path)
    request["Content-Type"] = "application/json"
    request["x-api-key"] = api_key
    request["anthropic-version"] = "2023-06-01"

    request.body = {
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: <<~PROMPT
          You just crawled a company's website (homepage and key subpages). Analyze all the content and return a JSON object with the following structure. Return ONLY valid JSON, no markdown fences, no extra text.

          {
            "summary": "2-3 sentence overview of what the company does",
            "industry": "Industry or sector (e.g. Healthcare Technology, E-commerce, FinTech)",
            "target_audience": "Who are their customers (1 sentence)",
            "products": ["Product/Service 1", "Product/Service 2", "Product/Service 3"],
            "differentiators": ["Key differentiator 1", "Key differentiator 2"],
            "tech_stack": ["Tech 1", "Tech 2"],
            "competitors": ["Competitor 1", "Competitor 2", "Competitor 3"]
          }

          For tech_stack: look for clues in the HTML (meta generators, script sources, CSS frameworks, headers). Common signals: WordPress, Shopify, Next.js, React, Rails, Webflow, Wix, Squarespace, HubSpot, etc. Also note any tech/infrastructure they mention on their site (e.g. "Built on AWS", "HIPAA compliant", "SOC 2 certified"). If you can't detect any, return ["Unknown"].

          For competitors: based on what the company does and their industry, list 3-5 well-known competitors or similar companies in the same space. Use your knowledge. These should be real companies.

          Company name: #{org_name}
          Website: #{url}

          === CRAWLED PAGES ===
          #{content_block}
          === END ===
        PROMPT
      }]
    }.to_json

    Rails.logger.info("[WebsiteAnalysisJob] Calling Anthropic API with key=#{api_key[0..12]}... model=claude-sonnet-4-6")
    response = http.request(request)
    result = JSON.parse(response.body)

    unless response.is_a?(Net::HTTPSuccess)
      error_type = result.dig("error", "type") || response.code
      error_msg = result.dig("error", "message") || response.body.truncate(200)
      Rails.logger.error("[WebsiteAnalysisJob] Anthropic API error: status=#{response.code} type=#{error_type} message=#{error_msg} key=#{api_key[0..12]}...")
      raise "Anthropic API returned #{response.code}: #{error_msg}"
    end

    text = result.dig("content", 0, "text")
    raise "Anthropic API returned empty response" unless text.present?
    text
  end
end

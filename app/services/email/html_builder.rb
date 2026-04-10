module Email
  # Converts a payload's text/html into a clean HTML email body.
  module HtmlBuilder
    module_function

    EMAIL_STYLE = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #202124;".freeze

    def build(payload)
      # If explicit HTML is provided, use it
      return payload[:body_html] if payload[:body_html].present? && payload[:body_html].include?("<")

      text = payload[:body_text].to_s.presence || payload[:body_html].to_s
      escaped = ERB::Util.html_escape(text)
      content = escaped
        .gsub(/\*\*(.+?)\*\*/, '<strong>\1</strong>')
        .gsub(/\n\n/, "</p><p>")
        .gsub(/\n/, "<br>")

      <<~HTML
        <div style="#{EMAIL_STYLE}">
          <p>#{content}</p>
        </div>
      HTML
    end
  end
end

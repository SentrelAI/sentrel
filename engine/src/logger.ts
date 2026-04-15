import winston from "winston";

// In production (LOG_FORMAT=json), output structured JSON for Better Stack.
// In development, keep the human-readable format.
const isJson = process.env.LOG_FORMAT === "json";

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  })
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const transports: winston.transport[] = [new winston.transports.Console()];

// Better Stack HTTP log drain (opt-in via BETTERSTACK_SOURCE_TOKEN)
const bsToken = process.env.BETTERSTACK_SOURCE_TOKEN;
if (bsToken) {
  transports.push(
    new winston.transports.Http({
      host: "in.logs.betterstack.com",
      path: "/",
      ssl: true,
      headers: { Authorization: `Bearer ${bsToken}` },
      level: "info",
    })
  );
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: isJson ? jsonFormat : devFormat,
  transports,
});

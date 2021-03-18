const winston = require('winston');

require('dotenv').config();

const { NODE_ENV } = process.env;

const logger = winston.createLogger({
  level: NODE_ENV === 'production' ? 'info' : 'silly',
  transports: [new winston.transports.Console()],
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
});

module.exports = logger;

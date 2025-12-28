const nodemailer = require('nodemailer');
const fetchImpl = require('node-fetch');
const config = require('../config/config');
const logger = require('../config/logger');

const useAhasend = config.email.provider === 'ahasend';
const transport = useAhasend ? null : nodemailer.createTransport({ ...config.email.smtp, connectionTimeout: 50000 });

const parseFromAddress = (from) => {
  if (!from) {
    return { email: undefined, name: undefined };
  }
  const match = from.match(/^(.*)<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
  }
  return { email: from.trim(), name: undefined };
};

const sendViaAhasend = async ({ to, subject, text, html }) => {
  if (!config.email.ahasend?.apiKey || !config.email.ahasend?.accountId) {
    throw new Error('AhaSend API credentials are missing');
  }

  const from = parseFromAddress(config.email.from);
  const payload = {
    from: {
      email: from.email,
      ...(from.name ? { name: from.name } : {}),
    },
    recipients: [{ email: to }],
    subject,
    text_content: text,
    ...(html ? { html_content: html } : {}),
  };

  const response = await fetchImpl(`${config.email.ahasend.baseUrl}/accounts/${config.email.ahasend.accountId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.ahasend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`AhaSend request failed: ${response.status} ${body}`);
    error.status = response.status;
    throw error;
  }
};
/* istanbul ignore next */
if (config.env !== 'test') {
  if (useAhasend) {
    logger.info('Using AhaSend API for email delivery');
  } else {
    transport
      .verify()
      .then(() => logger.info('Connected to email server'))
      .catch((e) => {
        logger.warn(e);
        logger.warn(e?.code);
        logger.warn(e?.responseCode);
        logger.warn({ host: config.email.smtp?.host, port: config.email.smtp?.port }, 'SMTP connection details');
      });
  }
}

/**
 * Send an email
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @returns {Promise}
 */
const sendEmail = async (to, subject, text, html) => {
  if (useAhasend) {
    await sendViaAhasend({ to, subject, text, html });
    return;
  }
  const msg = { from: config.email.from, to, subject, text, ...(html ? { html } : {}) };
  await transport.sendMail(msg);
};

/**
 * Send reset password email
 * @param {string} to
 * @param {string} token
 * @returns {Promise}
 */
const sendResetPasswordEmail = async (to, token) => {
  const subject = 'Reset password';
  const frontendBase = config.frontendUrl && config.frontendUrl !== '*' ? config.frontendUrl : 'http://localhost:5173';
  const resetPasswordUrl = `${frontendBase.replace(/\/$/, '')}/reset-password?token=${token}`;
  const text = `Dear user,
To reset your password, click on this link: ${resetPasswordUrl}
If you did not request any password resets, then ignore this email.`;
  await sendEmail(to, subject, text);
};

/**
 * Send verification email
 * @param {string} to
 * @param {string} token
 * @returns {Promise}
 */
const sendVerificationEmail = async (to, token) => {
  const subject = 'Email Verification';
  const frontendBase = config.frontendUrl && config.frontendUrl !== '*' ? config.frontendUrl : 'http://localhost:5173';
  const verificationEmailUrl = `${frontendBase.replace(/\/$/, '')}/verify-email?token=${token}`;
  const text = `Dear user,
To verify your email, click on this link: ${verificationEmailUrl}
If you did not create an account, then ignore this email.`;
  await sendEmail(to, subject, text);
};

module.exports = {
  transport,
  sendEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
};

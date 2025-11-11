const logger = require("firebase-functions/logger");
const fetch = require("node-fetch"); // Make sure this is in functions/package.json

// This is the Google Apps Script URL used for sending emails
// eslint-disable-next-line max-len
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzdcBKL0W8pGJ7w3DS3hKq5o-qvhqoja8MUVoGz9Xhh6ie36CYkYwLINccN8NnGVWiq/exec"; // Your URL

/**
 * Helper function to send email via your Google Apps Script.
 * Includes hardcoded CCs.
 * @param {string[]} to - An array of recipient email addresses.
 * @param {string} subject - The subject line of the email.
 * @param {string} htmlBody - The HTML content of the email.
 */
async function sendEmail(to, subject, htmlBody) {
  // Always send to these specific emails
  const alwaysSendTo = ["lpenrose@nptel.com"];

  // Use a Set to avoid sending duplicate emails
  const recipients = new Set([...to, ...alwaysSendTo]);
  const finalRecipients = Array.from(recipients);

  if (!finalRecipients || finalRecipients.length === 0) {
    logger.log("No recipients, skipping email send.");
    return;
  }

  logger.log(`Sending email via Apps Script to: ${finalRecipients.join(", ")}`);

  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "cors", // Although calling from backend, keep mode consistent
      credentials: "omit",
      redirect: "follow",
      body: JSON.stringify({
        to: finalRecipients.join(","),
        subject: subject,
        htmlBody: htmlBody,
      }),
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
    });
    logger.log("Email request sent successfully to Apps Script.");
  } catch (error) {
    logger.error("Error calling Google Apps Script:", error);
    // Throw the error so the calling function can handle it
    throw new Error(`Failed to send email via Apps Script: ${error.message}`);
  }
}

// Export the function
module.exports = { sendEmail };
/*
* This is your new functions/index.js file.
* It listens for new documents created in the `mail` subcollection
* and uses Email.js to send the email.
*/

// Import Firebase Functions and Admin SDK
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { logger } = require("firebase-functions");

// --- ADDED: Your local email helper ---
const { sendEmail } = require("./email.js");

// Initialize Firebase Admin
initializeApp();


/**
 * --- NEW HELPER ---
 * Creates a styled HTML body for the welcome email.
 */
function createWelcomeEmailHtml(customerName) {
  const subject = "Welcome to Community Fiber Network!";
  // Break HTML into smaller lines to satisfy the linter
  const htmlLines = [
    "<html lang=\"en\">",
    "<head><meta charset=\"UTF-8\"><title>" + subject + "</title></head>",
    "<body style=\"margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; line-height: 1.6; background-color: #f4f4f4;\">",
    "<table align=\"center\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"600\" style=\"width: 600px; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px; box-shadow: 0 0 10px rgba(0,0,0,0.1);\">",
    "<!-- Header with Logos -->",
    "<tr>",
    "<td bgcolor=\"#ffffff\" style=\"padding: 20px 25px; border-bottom: 1px solid #eeeeee;\">",
    "<table border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\">",
    "<tr>",
    "<td width=\"50%\" valign=\"middle\">",
    "<img src=\"https://cfn-contract.web.app/logos/NPtech-logo.png\" alt=\"NPTech Logo\" height=\"40\" style=\"display: block; height: 40px; width: auto;\">",
    "</td>",
    "<td width=\"50%\" valign=\"middle\" align=\"right\">",
    "<img src=\"https://cfn-contract.web.app/logos/community-fiber-logo.png\" alt=\"Community Fiber Logo\" height=\"40\" style=\"display: block; height: 40px; width: auto;\">",
    "</td>",
    "</tr>",
    "</table>",
    "</td>",
    "</tr>",
    "<!-- Main Content -->",
    "<tr>",
    "<td bgcolor=\"#ffffff\" style=\"padding: 30px 25px; color: #374151; font-size: 16px;\">",
    "<p style=\"margin: 0 0 15px 0; font-size: 16px;\">Dear " + customerName + ",</p>",
    "<p style=\"margin: 0 0 15px 0; font-size: 16px;\">Welcome, and thank you for subscribing to the Community Fiber Network Residential Internet Service. We truly appreciate your business and look forward to providing you with fast & reliable internet.</p>",
    "<p style=\"margin: 0 0 15px 0; font-size: 16px;\">Our locally operated fiber network offers <em>99.9% uptime</em>, and our experienced technicians are always nearby and ready to help should any issues arise.</p>",
    "<h2 style=\"font-size: 20px; margin: 25px 0 15px 0; font-weight: 600; color: #1F2937;\">What to Expect Next:</h2>",
    "<ol style=\"margin: 0 0 15px 0; padding-left: 20px; font-size: 16px;\">",
    "<li style=\"margin-bottom: 15px;\">",
    "<strong>Site Survey</strong><br>",
    "We’ll contact you soon to schedule a <em>site survey</em>. During this visit, we’ll determine how best to bring the fiber line into your home and where to set up your Wi-Fi. We’ll also identify the best location for the fiber drop and splice box (also called a Network Interface Device, or NID), and mark the spot with a white flag.",
    "</li>",
    "<li style=\"margin-bottom: 15px;\">",
    "<strong>Utility Locates</strong><br>",
    "Before burying begins, we will request utility locates for your property. If you have <em>private infrastructure</em> like electric, gas, septic lines, or irrigation systems, please mark them clearly or let us know.",
    "</li>",
    "<li style=\"margin-bottom: 15px;\">",
    "<strong>Fiber Burial</strong><br>",
    "After the survey, it typically takes <em>3 to 6 weeks</em> to bury the fiber line to your home, though in some cases it may be quicker—or slightly longer. We aim to bury the fiber underground to ensure long-term reliability and reduce the risk of service interruptions.",
    "</li>",
    "<li style=\"margin-bottom: 15px;\">",
    "<strong>Property Disturbance</strong><br>",
    "Some <em>temporary disruption</em> to your yard is unavoidable during installation. While any plow or track marks typically fade within a year, our fiber crew will work with you to address any major concerns.",
    "</li>",
    "<li style=\"margin-bottom: 15px;\">",
    "<strong>Fiber Connection and NID Installation</strong><br>",
    "Once the fiber is buried, we’ll connect it to the main line near the road. We will also install a <em>small NID box</em> on the side of your house. This part of the process can take <em>1 to 2 weeks</em>. If you ever need the NID moved (for example, during painting or siding work), please contact us.",
    "</li>",
    "<li style=\"margin-bottom: 15px;\">",
    "<strong>Final Installation (Inside work)</strong><br>",
    "All the work above is done <em>outside</em>, and you don’t need to be present. Once everything is in place and connected, we’ll reach out to schedule your <em>final installation appointment</em>, which typically takes <em>1–1.5 hours</em>.",
    "</li>",
    "</ol>",
    "<p style=\"margin: 0 0 15px 0; font-size: 16px;\">We hope this overview helps you understand the steps ahead. Your new fiber connection will offer the bandwidth and reliability needed for all your household internet needs. We’re proud to deliver <em>fiber—the best internet technology available today</em>—and we’re grateful to have you as a customer.</p>",
    "<p style=\"margin: 0 0 15px 0; font-size: 16px;\">Thank you again for choosing Community Fiber Network.</p>",
    "<p style=\"margin: 25px 0 0 0; font-size: 16px;\">Warm regards,</p>",
    "<p style=\"margin: 0 0 15px 0; font-size: 16px;\">The Community Fiber Network Team</p>",
    "<p style=\"margin: 0; font-size: 14px; color: #4B5563;\"><a href=\"https://www.communityfiber.net\" target=\"_blank\" style=\"color: #2563EB; text-decoration: none;\">www.communityfiber.net</a></p>",
    "<p style=\"margin: 0; font-size: 14px; color: #4B5563;\"><a href=\"mailto:homefiberinfo@communityfiber.net\" style=\"color: #2563EB; text-decoration: none;\">homefiberinfo@communityfiber.net</a></p>",
    "</td>",
    "</tr>",
    "<!-- Footer -->",
    "<tr>",
    "<td bgcolor=\"#f9f9f9\" style=\"padding: 20px 25px; text-align: center; color: #777777; font-size: 12px; border-top: 1px solid #eeeeee;\">",
    "<p style=\"margin: 0;\">Community Fiber Network | NPTech</p>",
    "<p style=\"margin: 5px 0 0 0;\">19066 Co Rd 46, New Paris, IN 46553</p>",
    "<p style=\"margin: 5px 0 0 0;\">Phone: (574) 831-2176 | <a href=\"https://np-tech.com\" target=\"_blank\" style=\"color: #2563EB; text-decoration: none;\">np-tech.com</a></p>",
    "</td>",
    "</tr>",
    "</table>",
    "</body>",
    "</html>",
  ];
  const body = htmlLines.join("\n");
  return { subject, body };
}


/**
 * Sends a welcome email when a new document is added to any user's
 * 'mail' subcollection.
 *
 * Listens to the wildcard path:
 * artifacts/{appId}/users/{userId}/mail/{mailId}
 */
exports.sendWelcomeEmail = onDocumentCreated(
    "artifacts/{appId}/users/{userId}/mail/{mailId}",
    async (event) => {
      logger.log("New mail document received, attempting to send email...");

      const snapshot = event.data;
      if (!snapshot) {
        logger.warn("No data associated with the event, exiting.");
        return;
      }

      const data = snapshot.data();

      // Get the email address and template data from the document
      const toEmail = data.to?.[0];
      const customerName = data.template?.data?.customerName;

      if (!toEmail) {
        logger.error("No 'to' email address found in the document.", data);
        return;
      }

      if (!customerName) {
        logger.error("No 'customerName' found in template data.", data);
        return;
      }

      logger.log(`Sending email to: ${toEmail} for customer: ${customerName}`);

      // 1. Generate the HTML email content
      const { subject, body } = createWelcomeEmailHtml(customerName);

      // 2. Send the email
      try {
        // Your email.js helper file handles the rest
        await sendEmail([toEmail], subject, body);

        logger.log(
            "Email.js send successful via Google Apps Script",
        );

        // (Optional) Update the document to show it has been sent
        return snapshot.ref.update({
          sent: true,
          sentAt: new Date(),
          deliveryStatus: "Request sent to Apps Script successfully.",
        });
      } catch (error) {
        logger.error("Google Apps Script send failed:", error);
        // (Optional) Update the document with the error
        return snapshot.ref.update({
          sent: false,
          error: error.message || "An unknown error occurred",
        });
      }
    },
);
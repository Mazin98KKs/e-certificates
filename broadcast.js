require('dotenv').config();
const axios = require('axios');
const xlsx = require('xlsx');
const cloudinary = require('cloudinary').v2;

// Environment variables for WhatsApp API
const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0/533978409805057/messages';
const WHATSAPP_API_TOKEN = 'EAAIIvDZBBh5sBO5H9LMaa4iZAHqh8ab5a3jz1ZBaz0VbX0rjNS6ghEEDIEZA4txm6OuVpXcWYlVS65dQHj10ynNRxzZAppz0oGA6nBsmGlswRsKzK7kotSv65zd1nyKmWUj1XGrLjHUbB3bl8iUYkHr7Yxm9P0riETWHMwDxEqphZCsaqIedPXi6gtt1fZBaWhOkgZDZD';

// Cloudinary configuration
cloudinary.config({
  cloud_name: 'dp9frbsjx',
  api_key: '772247735598813',
  api_secret: 'Pumk8FjFOB6AF56sqrFF-7zfFJE'
});

// Cloudinary image public ID
const CERTIFICATE_PUBLIC_ID = 'bestfriend_aamfqh';

// Path to the Excel file
const filePath = './recipients.xlsx';

// **🔹 Load recipients from Excel**
function loadRecipientsFromExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet);

  // **Ensure names and phone numbers exist**
  return data
    .filter(row => row.PhoneNumber && row.Name)
    .map(row => ({
      phoneNumber: row.PhoneNumber.toString().trim(),
      name: row.Name.trim()
    }));
}

// **🔹 Generate Cloudinary URL with Overlaid Name**
function generateCertificateImageUrl(name) {
  return cloudinary.url(CERTIFICATE_PUBLIC_ID, {
    transformation: [
      {
        overlay: {
          font_family: "Arial",
          font_size: 80,
          font_weight: "bold",
          text: encodeURIComponent(name)
        },
        gravity: "center",
        y: -50,
        color: "black"
      }
    ]
  });
}

// **🔹 Broadcast function to send messages**
async function sendBroadcast(templateName, recipients) {
  const url = WHATSAPP_API_URL;
  const token = WHATSAPP_API_TOKEN;

  for (const recipient of recipients) {
    try {
      const certificateImageUrl = generateCertificateImageUrl(recipient.name); // Personalized image with name

      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to: recipient.phoneNumber,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'ar' },
            components: [
              {
                type: 'header',
                parameters: [
                  { type: 'image', image: { link: certificateImageUrl } }
                ]
              },
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: recipient.name }
                ]
              }
            ]
          }
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`Message sent to ${recipient.phoneNumber} (${recipient.name}):`, response.data);
    } catch (error) {
      console.error(`Error sending message to ${recipient.phoneNumber}:`, error.response?.data || error.message);
    }
  }
}

// **🔹 Load recipients and send messages**
(async () => {
  try {
    const recipients = loadRecipientsFromExcel(filePath);
    if (!recipients.length) {
      console.error('No recipients found in the Excel sheet.');
      return;
    }

    console.log(`Sending messages to ${recipients.length} recipients...`);
    await sendBroadcast('gift3', recipients);
    console.log('Broadcast complete.');
  } catch (error) {
    console.error('Error during broadcast process:', error.message);
  }
})();

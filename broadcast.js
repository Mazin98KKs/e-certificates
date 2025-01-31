// Define environment variables directly in the code
const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0/533978409805057/messages';
const WHATSAPP_API_TOKEN = 'EAAIIvDZBBh5sBO5H9LMaa4iZAHqh8ab5a3jz1ZBaz0VbX0rjNS6ghEEDIEZA4txm6OuVpXcWYlVS65dQHj10ynNRxzZAppz0oGA6nBsmGlswRsKzK7kotSv65zd1nyKmWUj1XGrLjHUbB3bl8iUYkHr7Yxm9P0riETWHMwDxEqphZCsaqIedPXi6gtt1fZBaWhOkgZDZD';

if (!WHATSAPP_API_URL || !WHATSAPP_API_TOKEN) {
  console.error('Missing required environment variables for WhatsApp API.');
  process.exit(1);
}

const axios = require('axios');
const xlsx = require('xlsx');
const cloudinary = require('cloudinary').v2;

// Cloudinary configuration
cloudinary.config({
  cloud_name: 'dp9frbsjx',
  api_key: '772247735598813',
  api_secret: 'Pumk8FjFOB6AF56sqrFF-7zfFJE',
});

console.log("Cloudinary Config Loaded:", cloudinary.config());

// Path to the Excel file
const filePath = './recipients.xlsx';

// Cloudinary Public ID of the image
const cloudinaryPublicId = 'bestfriend_aamfqh';

// Load recipients from Excel
function loadRecipientsFromExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet);
  const recipientNumbers = data.map(row => row.PhoneNumber).filter(num => !!num);
  return recipientNumbers;
}

// Main broadcast function
async function sendBroadcast(templateName, cloudinaryId, recipientNumbers) {
  const url = WHATSAPP_API_URL;
  const token = WHATSAPP_API_TOKEN;

  // Cloudinary URL for the image based on the public ID
  const imageUrl = cloudinary.url(cloudinaryId);

  for (const recipient of recipientNumbers) {
    try {
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'ar' },
            components: [
              {
                type: 'header',
                parameters: [
                  {
                    type: 'image',
                    image: { link: imageUrl }
                  }
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
      console.log(`Message sent to ${recipient}:`, response.data);
    } catch (error) {
      console.error(`Error sending message to ${recipient}:`, error.response?.data || error.message);
    }
  }
}

// Load recipients and call the broadcast function
(async () => {
  try {
    const recipients = loadRecipientsFromExcel(filePath);
    if (!recipients.length) {
      console.error('No recipients found in the Excel sheet.');
      return;
    }

    console.log(`Sending messages to ${recipients.length} recipients...`);
    await sendBroadcast('gift2', cloudinaryPublicId, recipients);
    console.log('Broadcast complete.');
  } catch (error) {
    console.error('Error during broadcast process:', error.message);
  }
})();

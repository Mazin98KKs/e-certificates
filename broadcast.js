// Define environment variables directly in the code
const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0/567838906410459/messages';
const WHATSAPP_API_TOKEN = 'EAATw1es7w9gBO61z2q62nGzawL1mlGrFZAQLtrb7km2mZCnZAAengLuhDrddnRbalujZBdynPlnQImZCEsArVtUqKHXZAwTZBUk6it35vExomYfPZAMg3gOwqhDCnnUXnPZBsiiztjIZCiYhoKiOPW424EYtQRxHJfvkZCOfY70VyA9XD4IGbhVbF63OnPMVFAlvjWwEAZDZD';

if (!WHATSAPP_API_URL || !WHATSAPP_API_TOKEN) {
  console.error('Missing required environment variables for WhatsApp API.');
  process.exit(1);
}

const axios = require('axios');
const xlsx = require('xlsx');

// Path to the Excel file
const filePath = './recipients.xlsx';

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
async function sendBroadcast(templateName, recipientNumbers) {
  const url = WHATSAPP_API_URL;
  const token = WHATSAPP_API_TOKEN;

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
            language: { code: 'ar' }
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
    await sendBroadcast('wel_sel', recipients);
    console.log('Broadcast complete.');
  } catch (error) {
    console.error('Error during broadcast process:', error.message);
  }
})();

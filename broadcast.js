require('dotenv').config();
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary using your environment variable
cloudinary.config(process.env.CLOUDINARY_URL);

if (!process.env.WHATSAPP_API_URL || !process.env.WHATSAPP_API_TOKEN) {
  console.error("Missing required environment variables for WhatsApp API");
  process.exit(1);
}

// Define the Cloudinary public ID and generate the URL
const publicId = "bestfriend_aamfqh";
const imageUrl = cloudinary.url(publicId);

if (!imageUrl) {
  console.error("Failed to generate Cloudinary image URL");
  process.exit(1);
}

// Define the WhatsApp template name
const templateName = "gift2";

// The main function to send a broadcast
async function sendBroadcast(templateName, imageUrl, recipientNumbers) {
  const url = process.env.WHATSAPP_API_URL;
  const token = process.env.WHATSAPP_API_TOKEN;

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

// A simple function to load numbers from a local Excel file (e.g., "recipients.xlsx")
async function loadRecipientsFromExcel() {
  const xlsx = require('xlsx');
  const workbook = xlsx.readFile('recipients.xlsx');
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  // Assuming the numbers are in the first column
  const recipientNumbers = data.map(row => row[0]).filter(number => number);
  return recipientNumbers;
}

// Run the broadcast
async function run() {
  console.log("Loading recipient numbers from Excel...");
  const recipientNumbers = await loadRecipientsFromExcel();

  console.log("Sending broadcast...");
  await sendBroadcast(templateName, imageUrl, recipientNumbers);

  console.log("Broadcast completed.");
}

run().catch(error => {
  console.error("An error occurred:", error);
  process.exit(1);
});

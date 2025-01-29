// broadcast.js
require('dotenv').config();

console.log("Loaded environment variables:", Object.keys(process.env));
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

async function sendBroadcast() {
  // Check that required environment variables are set
  if (!process.env.CLOUDINARY_URL || !process.env.WHATSAPP_API_URL || !process.env.WHATSAPP_API_TOKEN) {
    console.error("Missing required environment variables.");
    return;
  }

  // Specify the Cloudinary image public ID to be used in the broadcast
  const cloudinaryPublicId = "bestfriend_aamfqh";

  // Specify the path to the Excel file with recipient numbers
  const excelFilePath = path.resolve(__dirname, 'recipients.xlsx');

  // Check if the Excel file exists
  if (!fs.existsSync(excelFilePath)) {
    console.error("Recipients Excel file not found:", excelFilePath);
    return;
  }

  // Load the Excel file and extract recipient numbers
  const workbook = xlsx.readFile(excelFilePath);
  const sheetName = workbook.SheetNames[0]; // Use the first sheet
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  // The first column (column A) contains the phone numbers
  const recipientNumbers = data.slice(1).map(row => row[0]).filter(Boolean);

  if (recipientNumbers.length === 0) {
    console.error("No recipient numbers found in the Excel file.");
    return;
  }

  console.log("Found recipient numbers:", recipientNumbers);

  // Construct the URL to the image hosted on Cloudinary
  const imageUrl = `${process.env.CLOUDINARY_URL}/image/upload/${cloudinaryPublicId}`;

  // Send the broadcast to each recipient
  for (const recipient of recipientNumbers) {
    try {
      const response = await axios.post(
        process.env.WHATSAPP_API_URL,
        {
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'template',
          template: {
            name: 'gift1',
            language: { code: 'ar' },
            components: [
              {
                type: 'header',
                parameters: [
                  {
                    type: 'image',
                    image: { link: imageUrl },
                  },
                ],
              },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log(`Message sent to ${recipient}:`, response.data);
    } catch (error) {
      console.error(`Error sending message to ${recipient}:`, error.response?.data || error.message);
    }
  }
}

sendBroadcast();

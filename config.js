/*************************************************************
 * config.js
 * Central place to load environment variables and export 
 * them for the rest of the application.
 *************************************************************/


module.exports = {
  port: process.env.PORT || 3000,
  verifyToken: process.env.VERIFY_TOKEN || 'mysecrettoken',

  // WhatsApp
  whatsappApiUrl: process.env.WHATSAPP_API_URL,     // e.g. 'https://graph.facebook.com/v14.0/whatsapp...'
  whatsappApiToken: process.env.WHATSAPP_API_TOKEN, // your WA business API token

  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,        // secret key
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET, // webhook signing secret

  // Cloudinary
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
};

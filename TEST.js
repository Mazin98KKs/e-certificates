


const url = "https://graph.facebook.com/v22.0/511694895370910/messages";
const options = {
  method: "POST",
  headers: {
    "Authorization": "Bearer EAATw1es7w9gBO16Jb2nGqoanqICvOgcVV75LVZC0a3J706G2n3ipxugZBgZBDg995h1pUFXUZAm2Ud95AvdLzTQw812UW7jMzWIeCVZCwcBZBIbAIW3i2ULqbRze7eyDEaps5D1BxwHnzFka4QTvktdygfe47ZAjmp4EnPkub7yiDozYQtSTufCGewQl9HugFXIBbe0fq78BUarR1bq0ytaMx7gnQdgIS84Qk7Rf1h0ZBDOdjkZBqviwB",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    to: "96897774615",
    type: "text",
    text: { body: "Hello from WhatsApp API!" }
  })
};

fetch(url, options)
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error("Error:", error));




const url = "https://graph.facebook.com/v22.0/562058050326305/messages";
const options = {
  method: "POST",
  headers: {
    "Authorization": "Bearer EAATw1es7w9gBO3u9H89EzAxwZB8QoV1NvRaNVHwbvqQLYoXTcVYp1biwVHfuID5fLZCLmAzdFzabu64M8f1pVKKh3bZA08HWKT3zxJGhFGgJQ5e1KCQKMQYaD86VkCATBfZBpCvS188rENvgcudigXyyPRk19qXFxri0wzvZBmpXPuXUDiLAtaF2XcYBcLkzaTkvb9xPuKkDqVBdINYu2vlinA4mGzZCsVG0QKbqV0fHMGMUS3Ddzt",
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

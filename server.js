const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Your configuration - set these as environment variables
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'your_verify_token_here';
const APP_SECRET = process.env.APP_SECRET || 'your_app_secret_here';
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL || 'your_zapier_webhook_url_here';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'your_instagram_access_token_here';

app.use(express.json());

// Webhook verification (Instagram will call this first)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  console.log('Webhook verification attempt:', { mode, token });
  
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed');
    res.status(403).send('Forbidden');
  }
});

// Verify webhook signature
function verifySignature(payload, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', APP_SECRET)
    .update(payload, 'utf8')
    .digest('hex');
  
  return signature === `sha256=${expectedSignature}`;
}

// Get comment details from Instagram API
async function getCommentDetails(commentId) {
  try {
    const response = await axios.get(`https://graph.instagram.com/${commentId}`, {
      params: {
        fields: 'id,text,username,timestamp,media',
        access_token: ACCESS_TOKEN
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching comment details:', error.response?.data || error.message);
    return null;
  }
}

// Get media details (post info)
async function getMediaDetails(mediaId) {
  try {
    const response = await axios.get(`https://graph.instagram.com/${mediaId}`, {
      params: {
        fields: 'id,caption,media_type,permalink,timestamp',
        access_token: ACCESS_TOKEN
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching media details:', error.response?.data || error.message);
    return null;
  }
}

// Send data to Zapier
async function sendToZapier(data) {
  try {
    await axios.post(ZAPIER_WEBHOOK_URL, data);
    console.log('Data sent to Zapier successfully');
  } catch (error) {
    console.error('Error sending to Zapier:', error.response?.data || error.message);
  }
}

// Handle incoming webhooks from Instagram
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const payload = JSON.stringify(req.body);
  
  // Verify the webhook signature
  if (!verifySignature(payload, signature)) {
    console.log('Invalid signature');
    return res.status(403).send('Forbidden');
  }
  
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));
  
  // Process the webhook data
  const { object, entry } = req.body;
  
  if (object === 'instagram') {
    for (const entryItem of entry) {
      if (entryItem.changes) {
        for (const change of entryItem.changes) {
          if (change.field === 'comments') {
            // New comment detected
            const commentId = change.value.id;
            const mediaId = change.value.media.id;
            
            console.log(`New comment detected: ${commentId} on media: ${mediaId}`);
            
            // Fetch detailed comment and media information
            const [commentDetails, mediaDetails] = await Promise.all([
              getCommentDetails(commentId),
              getMediaDetails(mediaId)
            ]);
            
            if (commentDetails && mediaDetails) {
              // Prepare data for Zapier
              const zapierData = {
                event_type: 'new_comment',
                comment: {
                  id: commentDetails.id,
                  text: commentDetails.text,
                  username: commentDetails.username,
                  timestamp: commentDetails.timestamp
                },
                post: {
                  id: mediaDetails.id,
                  caption: mediaDetails.caption || '',
                  media_type: mediaDetails.media_type,
                  permalink: mediaDetails.permalink,
                  timestamp: mediaDetails.timestamp
                },
                notification_time: new Date().toISOString()
              };
              
              // Send to Zapier
              await sendToZapier(zapierData);
            }
          }
        }
      }
    }
  }
  
  res.status(200).send('OK');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log('Endpoints:');
  console.log(`  GET  /webhook - Webhook verification`);
  console.log(`  POST /webhook - Receive Instagram notifications`);
  console.log(`  GET  /health - Health check`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

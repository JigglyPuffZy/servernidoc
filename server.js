import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import 'dotenv/config';
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY
});

// System prompt for the veterinary assistant
const SYSTEM_PROMPT = `You are Doctor Santi, a veterinarian who specializes in dog health and care.

Respond like a real doctor would - be professional, direct, and helpful. Keep your answers concise and practical. You can use markdown formatting when it helps organize information clearly, such as bullet points for lists of symptoms or recommendations. Speak naturally as if you're talking to a pet owner in your clinic.

When giving advice:
- Be warm but professional
- Give clear, simple recommendations
- Mention when they should see a vet in person
- Keep responses brief and to the point
- Don't over-explain unless asked for more details

Remember you're an AI assistant, so if something seems serious or you're unsure, always recommend they consult with their local veterinarian.`;

// Chat endpoint with streaming
app.post('/api/chat', async (req, res) => {
  const {
    message,
    history = []
  } = req.body;
  
  try {
    // Set up proper headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Format history for OpenAI - ensure proper alternating user/assistant pattern
    let formattedHistory = [
      {
        role: "system",
        content: SYSTEM_PROMPT
      }
    ];
    
    if (history.length > 0) {
      // Filter and format history, ensuring it starts with user and alternates properly
      const validHistory = [];
      
      for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const role = msg.type === 'user' ? 'user' : 'assistant';
        
        // Ensure first message is from user
        if (validHistory.length === 0 && role !== 'user') {
          continue; // Skip non-user messages at the start
        }
        
        // Ensure alternating pattern (user -> assistant -> user -> assistant...)
        const lastRole = validHistory.length > 0 ? validHistory[validHistory.length - 1].role : null;
        if (lastRole && lastRole === role) {
          continue; // Skip consecutive messages from same role
        }
        
        validHistory.push({
          role: role,
          content: msg.content
        });
      }
      
      formattedHistory = formattedHistory.concat(validHistory);
    }
    
    // Add the new user message
    formattedHistory.push({
      role: "user",
      content: message
    });
    
    // Create a streaming response
    const stream = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: formattedHistory,
      stream: true,
      temperature: 0.7,
      max_tokens: 1000,
      top_p: 0.8
    });
    
    // Stream each chunk as it arrives
    for await (const chunk of stream) {
      const chunkText = chunk.choices[0]?.delta?.content || '';
      if (chunkText) {
        res.write(`data: ${JSON.stringify({
          text: chunkText
        })}\n\n`);
      }
    }
    
    // Signal end of stream
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Error with OpenAI API:', error);
    res.status(500).json({
      error: 'Failed to get response from AI',
      details: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
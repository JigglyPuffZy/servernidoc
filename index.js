const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Initialize Gemini AI with your API key
const genAI = new GoogleGenerativeAI('AIzaSyApCXaSjFBliLzjRWxYZar4IJWtBPr0FFY');

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.get('/api', (req, res) => {
  res.send('Working!');
});

// Health check endpoint for Gemini API status
app.get('/api/health', async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent('test');
    await result.response;
    res.json({ status: 'healthy', message: 'Gemini API is working correctly' });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({ 
      status: 'unhealthy', 
      message: 'Gemini API is currently unavailable',
      error: error.message 
    });
  }
});

// Utility function for exponential backoff retry
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fallback response function for when all models are unavailable
function getFallbackResponse(userMessage) {
  const message = userMessage.toLowerCase();
  
  // Common greetings
  if (message.includes('hello') || message.includes('hi') || message.includes('hey')) {
    return "Hello! Welcome to LOVATO Electric. I'm here to help you with information about our electrical products and solutions. How can I assist you today?";
  }
  
  // Help requests
  if (message.includes('help') || message.includes('support')) {
    return "I'm here to help you with LOVATO Electric products and services! I can provide information about our switch disconnectors, changeover switches, electrical equipment, and more. What would you like to know?";
  }
  
  // About the company
  if (message.includes('company') || message.includes('about') || message.includes('lovato')) {
    return "LOVATO Electric is a leading electrical solutions provider specializing in electrical equipment, automation, and energy management solutions. We offer a wide range of products including switch disconnectors, changeover switches, and electrical components for industrial applications.";
  }
  
  // Contact information
  if (message.includes('contact') || message.includes('phone') || message.includes('email') || message.includes('address')) {
    return "You can contact LOVATO Electric USA at: 2017 Georgetown Blvd., Chesapeake, VA 23325, United States. Phone: +1 757 545-4700. Email: sales@lovatousa.com. We serve customers across multiple countries including USA, Canada, UK, Germany, France, Italy, and many others.";
  }
  
  // Products - Switch disconnectors
  if (message.includes('switch disconnector') || message.includes('gl series') || message.includes('disconnector')) {
    return "LOVATO Electric offers GL series switch disconnectors up to 1000A. These feature extremely compact bodies, fast actuation technology, and can handle loads up to 1000A at 500V or 800A for higher voltages. They're available in UL98 versions for USA/Canada applications from 100A to 800A and can be mounted with 4 screws without positioning restrictions.";
  }
  
  // Products - Changeover switches
  if (message.includes('changeover') || message.includes('glc') || message.includes('transfer switch')) {
    return "Our GLC changeover switches are pre-assembled in three-pole and four-pole configurations. They feature compact design, electrical compatibility for various applications, and can be plate-mounted using 4 screws. They include transparent windows to view power contact positions and integrated padlock fittings.";
  }
  
  // Technical specifications
  if (message.includes('specification') || message.includes('rating') || message.includes('voltage') || message.includes('current')) {
    return "LOVATO Electric products feature high protection ratings (IP66, IP69K, NEMA 4X), UL508A compliance for door interlock handles, and support for various installation requirements. Our switch disconnectors can handle up to 1000A at 500V with category AC23A switching capability.";
  }
  
  // Installation and accessories
  if (message.includes('install') || message.includes('mount') || message.includes('accessory') || message.includes('handle')) {
    return "Our products can be mounted with 4 screws without positioning restrictions. We offer door interlock handles with various shaft lengths, auxiliary contacts, terminal covers, phase barriers, and more. All accessories snap on securely for quick, tool-free installation.";
  }
  
  // Default fallback for non-LOVATO topics
  if (message.includes('weather') || message.includes('sport') || message.includes('movie') || message.includes('music') || 
      message.includes('recipe') || message.includes('travel') || message.includes('politics') || message.includes('news')) {
    return "I'm sorry, I don't know about that. I'm specifically designed to help with LOVATO Electric products and services. Is there anything I can help you with regarding our electrical equipment, switch disconnectors, or other LOVATO products?";
  }
  
  // Default fallback
  return "I'm here to help with LOVATO Electric products and services. I can provide information about our switch disconnectors, changeover switches, electrical equipment, and technical specifications. What would you like to know about our products?";
}

// Retry function with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Check if it's a retryable error
      const isRetryable = error.message.includes('503') || 
                         error.message.includes('Service Unavailable') ||
                         error.message.includes('overloaded') ||
                         error.message.includes('429') ||
                         error.message.includes('Too Many Requests');
      
      if (!isRetryable) {
        throw error;
      }
      
      const waitTime = baseDelay * Math.pow(2, attempt);
      console.log(`Attempt ${attempt + 1} failed, retrying in ${waitTime}ms...`);
      await delay(waitTime);
    }
  }
}

// Streaming Gemini API endpoint
app.post('/api/gemini/stream', async (req, res) => {
  try {
    const { contents } = req.body;
    
    if (!contents || !contents[0] || !contents[0].parts || !contents[0].parts[0].text) {
      return res.status(400).json({ 
        error: 'Invalid request format. Expected contents array with parts containing text.' 
      });
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Get the user's message
    const userMessage = contents[0].parts[0].text;
    
    // Try different models in order of preference
    const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
    
    let lastError;
    
    for (const modelName of models) {
      try {
        console.log(`Attempting to use model: ${modelName}`);
        
        const result = await retryWithBackoff(async () => {
          const model = genAI.getGenerativeModel({ model: modelName });
          
          // Create a system prompt that makes the AI an expert about LOVATO Electric
          const systemPrompt = `You are an expert customer service representative for LOVATO Electric, a leading electrical solutions provider. You have extensive knowledge about our products and services.

Key Information about LOVATO Electric:
- Company: LOVATO Electric specializes in electrical equipment, automation, and energy management solutions
- Products: Switch disconnectors (GL series up to 1000A), changeover switches (GLC series), electrical components
- Contact: 2017 Georgetown Blvd., Chesapeake, VA 23325, USA. Phone: +1 757 545-4700. Email: sales@lovatousa.com
- Global presence: USA, Canada, UK, Germany, France, Italy, Spain, Poland, China, and many other countries

Product Details:
- GL Series Switch Disconnectors: Up to 1000A, compact design, fast actuation, UL98 versions available
- GLC Changeover Switches: Three-pole and four-pole configurations, transparent windows, integrated padlock fittings
- Protection ratings: IP66, IP69K, NEMA 4X
- Installation: 4-screw mounting, no positioning restrictions
- Accessories: Door interlock handles, auxiliary contacts, terminal covers, phase barriers

IMPORTANT: If asked about topics unrelated to LOVATO Electric (like weather, sports, movies, politics, etc.), politely decline and redirect to LOVATO products. You should say "I'm sorry, I don't know about that. I'm specifically designed to help with LOVATO Electric products and services. Is there anything I can help you with regarding our electrical equipment?"

Always be helpful, professional, and focus on LOVATO Electric products and services.`;

          const fullPrompt = `${systemPrompt}\n\nUser Question: ${userMessage}`;
          return await model.generateContentStream(fullPrompt);
        });
        
        // Stream the response
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          if (chunkText) {
            res.write(`data: ${JSON.stringify({ text: chunkText, done: false })}\n\n`);
          }
        }
        
        // Send completion signal
        res.write(`data: ${JSON.stringify({ text: '', done: true })}\n\n`);
        res.end();
        return;
        
      } catch (error) {
        console.error(`Error with model ${modelName}:`, error.message);
        lastError = error;
        
        // If it's not a retryable error, break out of the model loop
        if (!error.message.includes('503') && 
            !error.message.includes('Service Unavailable') && 
            !error.message.includes('overloaded') &&
            !error.message.includes('429') &&
            !error.message.includes('Too Many Requests')) {
          break;
        }
        
        // Continue to next model
        continue;
      }
    }
    
    // If we get here, all models failed
    // Provide a fallback response
    console.log('All Gemini models failed, providing fallback response');
    
    const fallbackResponse = getFallbackResponse(userMessage);
    if (fallbackResponse) {
      // Stream the fallback response character by character for effect
      for (let i = 0; i < fallbackResponse.length; i++) {
        res.write(`data: ${JSON.stringify({ text: fallbackResponse[i], done: false })}\n\n`);
        await delay(50); // Small delay for streaming effect
      }
      res.write(`data: ${JSON.stringify({ text: '', done: true })}\n\n`);
      res.end();
      return;
    }
    
    // Send error as stream
    res.write(`data: ${JSON.stringify({ error: 'All models failed', done: true })}\n\n`);
    res.end();
    
  } catch (error) {
    console.error('Streaming Gemini API Error:', error);
    
    // Send error as stream
    res.write(`data: ${JSON.stringify({ 
      error: 'Internal server error. Please try again later.',
      details: error.message,
      done: true 
    })}\n\n`);
    res.end();
  }
});

// Regular Gemini API endpoint with improved error handling and retry logic
app.post('/api/gemini', async (req, res) => {
  try {
    const { contents } = req.body;
    
    if (!contents || !contents[0] || !contents[0].parts || !contents[0].parts[0].text) {
      return res.status(400).json({ 
        error: 'Invalid request format. Expected contents array with parts containing text.' 
      });
    }

    // Get the user's message
    const userMessage = contents[0].parts[0].text;
    
    // Try different models in order of preference
    const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
    
    let lastError;
    
    for (const modelName of models) {
      try {
        console.log(`Attempting to use model: ${modelName}`);
        
        const result = await retryWithBackoff(async () => {
          const model = genAI.getGenerativeModel({ model: modelName });
          
          // Create a system prompt that makes the AI an expert about LOVATO Electric
          const systemPrompt = `You are an expert customer service representative for LOVATO Electric, a leading electrical solutions provider. You have extensive knowledge about our products and services.

Key Information about LOVATO Electric:
- Company: LOVATO Electric specializes in electrical equipment, automation, and energy management solutions
- Products: Switch disconnectors (GL series up to 1000A), changeover switches (GLC series), electrical components
- Contact: 2017 Georgetown Blvd., Chesapeake, VA 23325, USA. Phone: +1 757 545-4700. Email: sales@lovatousa.com
- Global presence: USA, Canada, UK, Germany, France, Italy, Spain, Poland, China, and many other countries

Product Details:
- GL Series Switch Disconnectors: Up to 1000A, compact design, fast actuation, UL98 versions available
- GLC Changeover Switches: Three-pole and four-pole configurations, transparent windows, integrated padlock fittings
- Protection ratings: IP66, IP69K, NEMA 4X
- Installation: 4-screw mounting, no positioning restrictions
- Accessories: Door interlock handles, auxiliary contacts, terminal covers, phase barriers

IMPORTANT: If asked about topics unrelated to LOVATO Electric (like weather, sports, movies, politics, etc.), politely decline and redirect to LOVATO products. You should say "I'm sorry, I don't know about that. I'm specifically designed to help with LOVATO Electric products and services. Is there anything I can help you with regarding our electrical equipment?"

Always be helpful, professional, and focus on LOVATO Electric products and services.`;

          const fullPrompt = `${systemPrompt}\n\nUser Question: ${userMessage}`;
          return await model.generateContent(fullPrompt);
        });
        
        const response = await result.response;
        const text = response.text();
        
        // Format response to match Gemini API structure
        const geminiResponse = {
          candidates: [{
            content: {
              parts: [{
                text: text
              }]
            }
          }]
        };
        
        return res.json(geminiResponse);
        
      } catch (error) {
        console.error(`Error with model ${modelName}:`, error.message);
        lastError = error;
        
        // If it's not a retryable error, break out of the model loop
        if (!error.message.includes('503') && 
            !error.message.includes('Service Unavailable') && 
            !error.message.includes('overloaded') &&
            !error.message.includes('429') &&
            !error.message.includes('Too Many Requests')) {
          break;
        }
        
        // Continue to next model
        continue;
      }
    }
    
    // If we get here, all models failed
    // Provide a fallback response for common queries
    console.log('All Gemini models failed, providing fallback response');
    
    const fallbackResponse = getFallbackResponse(userMessage);
    if (fallbackResponse) {
      const geminiResponse = {
        candidates: [{
          content: {
            parts: [{
              text: fallbackResponse
            }]
          }
        }]
      };
      return res.json(geminiResponse);
    }
    
    throw lastError;
    
  } catch (error) {
    console.error('Gemini API Error:', error);
    
    // Handle specific Gemini API errors
    if (error.message.includes('API_KEY_INVALID')) {
      return res.status(401).json({ 
        error: 'Invalid API key. Please check your Gemini API key configuration.' 
      });
    }
    
    if (error.message.includes('QUOTA_EXCEEDED')) {
      return res.status(429).json({ 
        error: 'API quota exceeded. Please try again later.' 
      });
    }
    
    if (error.message.includes('SAFETY')) {
      return res.status(400).json({ 
        error: 'Content blocked by safety filters. Please rephrase your message.' 
      });
    }
    
    // Handle 503 Service Unavailable specifically
    if (error.message.includes('503') || error.message.includes('Service Unavailable') || error.message.includes('overloaded')) {
      return res.status(503).json({ 
        error: 'Gemini API is currently overloaded. Please try again in a few moments.',
        retryAfter: 30 // Suggest retry after 30 seconds
      });
    }
    
    // Generic error response
    res.status(500).json({ 
      error: 'Internal server error. Please try again later.',
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Gemini API endpoint available at http://localhost:${PORT}/api/gemini`);
});
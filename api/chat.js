import OpenAI from 'openai';

export default async function handler(request, response) {
  // Only allow POST requests
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Set up proper headers for streaming
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');

  try {
    const { message, history = [] } = request.body;

    // Validate message
    if (!message) {
      response.status(400).json({ error: 'Message is required' });
      return;
    }

    // Initialize OpenAI API
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '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'
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
        response.write(`data: ${JSON.stringify({
          text: chunkText
        })}\n\n`);
      }
    }
    
    // Signal end of stream
    response.write('data: [DONE]\n\n');
    response.end();
  } catch (error) {
    console.error('Error with OpenAI API:', error);
    // If headers already sent, we can't send a JSON response
    if (!response.headersSent) {
      response.status(500).json({
        error: 'Failed to get response from AI',
        details: error.message
      });
    } else {
      response.write(`data: ${JSON.stringify({
        error: 'Failed to get response from AI'
      })}\n\n`);
      response.end();
    }
  }
}
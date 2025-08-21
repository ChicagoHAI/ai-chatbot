import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { createGuestUser, getChatById, saveChat, saveMessages } from '@/lib/db/queries';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const { messages, id } = await req.json();

    // Add null check for messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'No messages provided' },
        { status: 400 }
      );
    }

    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return NextResponse.json(
        { error: 'No user message found' },
        { status: 400 }
      );
    }

    const query = lastMessage.content;
    console.log('[multi-agent] Processing query:', query);

    // Get or create user
    let userId = session?.user?.id;
    if (!userId) {
      console.log('[multi-agent] No user session, creating guest user');
      const guestUser = await createGuestUser();
      userId = guestUser.id;
    }

    // Get or create chat
    let chat = await getChatById(id);
    if (!chat) {
      console.log('[multi-agent] Creating new chat with id:', id);
      chat = await saveChat({
        id,
        userId,
        title: query.slice(0, 100),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Call the backend multi-agent system
    const backendResponse = await fetch('http://localhost:8080/api/multi-agent-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        query: query,
        conversation_id: id,
        conversation_history: messages.slice(-5), // Last 5 messages for context
      }),
    });

    if (!backendResponse.ok) {
      console.error('[multi-agent] Backend error:', backendResponse.status, backendResponse.statusText);
      throw new Error(`Backend responded with status: ${backendResponse.status}`);
    }

    const result = await backendResponse.json();
    console.log('[multi-agent] Backend response:', {
      agent_type: result.agent_type,
      content_length: result.content?.length,
      routing_info: result.routing_info,
    });

    // Save the messages to database
    const messagesToSave = [
      {
        id: `user-${Date.now()}`,
        chatId: id,
        role: 'user',
        content: query,
        createdAt: new Date(),
      },
      {
        id: `assistant-${Date.now()}`,
        chatId: id,
        role: 'assistant',
        content: result.content,
        createdAt: new Date(),
      },
    ];

    await saveMessages(messagesToSave);

    // Return the response in AI SDK format
    return NextResponse.json({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: result.content,
      metadata: {
        agent_type: result.agent_type,
        routing_info: result.routing_info,
        ...result.metadata,
      },
    });

  } catch (error) {
    console.error('[multi-agent] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    const { query, papers, userId, conversationId } = await req.json();

    console.log('[multi-agent] Generating hypotheses for:', query);

    // Call the backend hypothesis generation endpoint
    const backendResponse = await fetch('http://localhost:8080/api/multi-agent-hypotheses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId || session?.user?.id || 'anonymous',
        query: query,
        conversation_id: conversationId,
        conversation_history: [],
      }),
    });

    if (!backendResponse.ok) {
      console.error('[multi-agent] Hypothesis generation error:', backendResponse.status);
      throw new Error(`Backend responded with status: ${backendResponse.status}`);
    }

    // Read the streaming response
    const reader = backendResponse.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    let fullContent = '';
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            break;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content' && parsed.char) {
              fullContent += parsed.char;
            }
          } catch (e) {
            // If not JSON, treat as plain text
            fullContent += data;
          }
        }
      }
    }

    console.log('[multi-agent] Generated hypotheses, length:', fullContent.length);

    return NextResponse.json({
      content: fullContent,
      agent_type: 'research',
      metadata: {
        hypothesis_generation: true,
        papers_used: papers?.length || 0,
      },
    });

  } catch (error) {
    console.error('[multi-agent] Hypothesis generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate hypotheses' },
      { status: 500 }
    );
  }
}

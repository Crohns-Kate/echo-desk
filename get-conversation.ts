import { storage } from './server/storage';

async function getConversation() {
  try {
    const conversation = await storage.getConversation(117);

    if (!conversation) {
      console.log(JSON.stringify({ error: 'Conversation not found' }, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify({
      id: conversation.id,
      createdAt: conversation.createdAt,
      context: conversation.context
    }, null, 2));
  } catch (error: any) {
    console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
  }
}

getConversation();

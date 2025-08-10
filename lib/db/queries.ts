import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  user,
  chat,
  type User,
  document,
  type Suggestion,
  suggestion,
  message,
  vote,
  type DBMessage,
  type Chat,
  stream,
  hypothesisFeedback,
  hypothesis,
  individualHypothesisFeedback,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';
import { generateUUID } from '../utils';
import { generateHashedPassword } from './utils';
import type { VisibilityType } from '@/components/visibility-selector';
import { ChatSDKError } from '../errors';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);

export async function getUser(email: string): Promise<Array<User>> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get user by email',
    );
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to create user');
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    console.log(`[createGuestUser] Creating guest user with email: ${email}`);
    const result = await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
    console.log(`[createGuestUser] Successfully created guest user: ${result[0]?.id}`);
    return result;
  } catch (error) {
    console.error(`[createGuestUser] Error creating guest user:`, error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create guest user',
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    console.log(`[saveChat] Attempting to save chat ${id} for user ${userId}`);
    const result = await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
    console.log(`[saveChat] Successfully saved chat ${id}`);
    return result;
  } catch (error) {
    console.error(`[saveChat] Error saving chat ${id}:`, error);
    // Check if it's a duplicate key error (chat already exists)
    if (error instanceof Error && error.message.includes('duplicate key')) {
      console.log(`[saveChat] Chat ${id} already exists, continuing...`);
      return null; // Return null instead of throwing error
    }
    throw new ChatSDKError('bad_request:database', 'Failed to save chat');
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    // Delete in proper order to handle foreign key constraints
    // First delete votes
    await db.delete(vote).where(eq(vote.chatId, id));
    
    // Delete messages (this will cascade to delete hypotheses due to onDelete: 'cascade')
    // and also delete any individual hypothesis feedback
    await db.delete(message).where(eq(message.chatId, id));
    
    // Delete streams
    await db.delete(stream).where(eq(stream.chatId, id));

    // Finally delete the chat itself
    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    
    console.log(`[deleteChatById] Successfully deleted chat ${id}`);
    return chatsDeleted;
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete chat by id',
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    console.log(`[getChatsByUserId] Attempting to get chats for user ${id}`);
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id),
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Array<Chat> = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        console.log(`[getChatsByUserId] Chat with id ${startingAfter} not found, returning empty result`);
        return {
          chats: [],
          hasMore: false,
        };
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        console.log(`[getChatsByUserId] Chat with id ${endingBefore} not found, returning empty result`);
        return {
          chats: [],
          hasMore: false,
        };
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;
    const result = {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };

    console.log(`[getChatsByUserId] Successfully retrieved ${result.chats.length} chats for user ${id}`);
    return result;
  } catch (error) {
    console.error(`[getChatsByUserId] Error getting chats for user ${id}:`, error);
    // Return empty result instead of throwing error to prevent frontend crashes
    return {
      chats: [],
      hasMore: false,
    };
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    console.log(`[getChatById] Attempting to get chat ${id}`);
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    console.log(`[getChatById] Successfully retrieved chat ${id}`);
    return selectedChat;
  } catch (error) {
    console.error(`[getChatById] Error getting chat ${id}:`, error);
    // Return null instead of throwing error to prevent frontend crashes
    return null;
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<DBMessage>;
}) {
  try {
    console.log(`[saveMessages] Attempting to save ${messages.length} messages`);
    const result = await db.insert(message).values(messages);
    console.log(`[saveMessages] Successfully saved ${messages.length} messages`);
    return result;
  } catch (error) {
    console.error(`[saveMessages] Error saving messages:`, error);
    // Check if it's a duplicate key error (message already exists)
    if (error instanceof Error && error.message.includes('duplicate key')) {
      console.log(`[saveMessages] Messages already exist, continuing...`);
      return null; // Return null instead of throwing error
    }
    throw new ChatSDKError('bad_request:database', 'Failed to save messages');
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    console.log(`[getMessagesByChatId] Attempting to get messages for chat ${id}`);
    const messages = await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
    console.log(`[getMessagesByChatId] Successfully retrieved ${messages.length} messages for chat ${id}`);
    return messages;
  } catch (error) {
    console.error(`[getMessagesByChatId] Error getting messages for chat ${id}:`, error);
    // Return empty array instead of throwing error to prevent frontend crashes
    return [];
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: 'up' | 'down';
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === 'up' })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === 'up',
    });
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to vote message');
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get votes by chat id',
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save document');
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get documents by id',
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get document by id',
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp),
        ),
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete documents by id after timestamp',
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Array<Suggestion>;
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to save suggestions',
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.documentId, documentId)));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get suggestions by document id',
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get message by id',
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)),
      );

    const messageIds = messagesToDelete.map((message) => message.id);

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds)),
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );
    }
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete messages by chat id after timestamp',
    );
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: 'private' | 'public';
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat visibility by id',
    );
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: { id: string; differenceInHours: number }) {
  try {
    console.log(`[getMessageCountByUserId] Getting message count for user ${id} in last ${differenceInHours} hours`);
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000,
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, 'user'),
        ),
      )
      .execute();

    const messageCount = stats?.count ?? 0;
    console.log(`[getMessageCountByUserId] Found ${messageCount} messages for user ${id}`);
    return messageCount;
  } catch (error) {
    console.error(`[getMessageCountByUserId] Error getting message count for user ${id}:`, error);
    // If there's an error, return 0 instead of throwing
    console.log(`[getMessageCountByUserId] Returning 0 for user ${id} due to error`);
    return 0;
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create stream id',
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get stream ids by chat id',
    );
  }
}

// Hypothesis Feedback queries
export async function getHypothesisFeedbackByMessageId({
  messageId,
  userId,
}: {
  messageId: string;
  userId: string;
}) {
  try {
    const feedback = await db
      .select()
      .from(hypothesisFeedback)
      .where(
        and(
          eq(hypothesisFeedback.messageId, messageId),
          eq(hypothesisFeedback.userId, userId)
        )
      )
      .limit(1);

    return feedback[0] || null;
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get hypothesis feedback',
    );
  }
}

export async function saveHypothesisFeedback({
  chatId,
  messageId,
  userId,
  rating,
  feedbackText,
  feedbackType,
  hypothesisRatings,
}: {
  chatId: string;
  messageId: string;
  userId: string;
  rating: 'helpful' | 'not_helpful' | 'needs_improvement';
  feedbackText?: string;
  feedbackType?: 'quality' | 'novelty' | 'feasibility' | 'clarity' | 'other';
  hypothesisRatings?: Record<string, 'helpful' | 'not_helpful' | 'needs_improvement'>;
}) {
  try {
    const existingFeedback = await getHypothesisFeedbackByMessageId({
      messageId,
      userId,
    });

    if (existingFeedback) {
      // Update existing feedback
      const updatedFeedback = await db
        .update(hypothesisFeedback)
        .set({
          rating,
          feedbackText,
          feedbackType,
          hypothesisRatings,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(hypothesisFeedback.messageId, messageId),
            eq(hypothesisFeedback.userId, userId)
          )
        )
        .returning();

      return updatedFeedback[0];
    } else {
      // Create new feedback
      const newFeedback = await db
        .insert(hypothesisFeedback)
        .values({
          chatId,
          messageId,
          userId,
          rating,
          feedbackText,
          feedbackType,
          hypothesisRatings,
        })
        .returning();

      return newFeedback[0];
    }
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to save hypothesis feedback',
    );
  }
}

export async function getHypothesisFeedbackStats({
  messageId,
}: {
  messageId: string;
}) {
  try {
    const stats = await db
      .select({
        rating: hypothesisFeedback.rating,
        count: count(),
      })
      .from(hypothesisFeedback)
      .where(eq(hypothesisFeedback.messageId, messageId))
      .groupBy(hypothesisFeedback.rating);

    return stats.reduce((acc, { rating, count }) => {
      acc[rating] = count;
      return acc;
    }, {} as Record<string, number>);
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get hypothesis feedback stats',
    );
  }
}

// ===== Individual Hypothesis Functions =====

export async function upsertHypothesis({
  id,
  messageId,
  title,
  description,
  orderIndex,
}: {
  id: string;
  messageId: string;
  title: string;
  description: string;
  orderIndex: number;
}) {
  try {
    const result = await db
      .insert(hypothesis)
      .values({
        id,
        messageId,
        title,
        description,
        orderIndex,
      })
      .onConflictDoUpdate({
        target: hypothesis.id,
        set: {
          title,
          description,
          orderIndex,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to upsert hypothesis',
    );
  }
}

export async function saveHypotheses({
  messageId,
  hypotheses: hypothesisData,
}: {
  messageId: string;
  hypotheses: Array<{
    id: string;
    title: string;
    description: string;
    orderIndex: number;
  }>;
}) {
  try {
    // First verify that the message exists
    const messageExists = await db
      .select({ id: message.id })
      .from(message)
      .where(eq(message.id, messageId))
      .limit(1);
    
    if (messageExists.length === 0) {
      console.warn(`[saveHypotheses] Message ${messageId} not found in database - may still be processing`);
      throw new Error(`Message ${messageId} not found`);
    }
    
    if (hypothesisData.length === 0) {
      return [];
    }

    // Use upsert approach to handle race conditions
    const newHypotheses = [];
    
    for (const h of hypothesisData) {
      try {
        const result = await db
          .insert(hypothesis)
          .values({
            id: h.id,
            messageId,
            title: h.title,
            description: h.description,
            orderIndex: h.orderIndex,
          })
          .onConflictDoUpdate({
            target: hypothesis.id,
            set: {
              title: h.title,
              description: h.description,
              orderIndex: h.orderIndex,
            },
          })
          .returning();
        
        newHypotheses.push(result[0]);
      } catch (err) {
        console.error(`[saveHypotheses] Failed to save hypothesis ${h.id}:`, err);
        // Continue with other hypotheses instead of failing completely
      }
    }

    console.log(`[saveHypotheses] Successfully saved ${newHypotheses.length} hypotheses for message ${messageId}`);
    return newHypotheses;
  } catch (error) {
    console.error('[saveHypotheses] Database error:', error);
    console.error('[saveHypotheses] MessageId:', messageId);
    console.error('[saveHypotheses] Hypotheses data:', hypothesisData);
    throw new ChatSDKError(
      'bad_request:database',
      `Failed to save hypotheses: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

export async function getHypothesesByMessageId({
  messageId,
}: {
  messageId: string;
}) {
  try {
    const hypotheses = await db
      .select()
      .from(hypothesis)
      .where(eq(hypothesis.messageId, messageId))
      .orderBy(asc(hypothesis.orderIndex));

    return hypotheses;
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get hypotheses',
    );
  }
}

export async function saveIndividualHypothesisFeedback({
  hypothesisId,
  userId,
  rating,
  feedbackText,
  feedbackCategory,
}: {
  hypothesisId: string;
  userId: string;
  rating: 'helpful' | 'not_helpful' | 'needs_improvement';
  feedbackText?: string;
  feedbackCategory?: 'quality' | 'novelty' | 'feasibility' | 'clarity' | 'other';
}) {
  try {
    // Check if feedback already exists
    const existingFeedback = await db
      .select()
      .from(individualHypothesisFeedback)
      .where(
        and(
          eq(individualHypothesisFeedback.hypothesisId, hypothesisId),
          eq(individualHypothesisFeedback.userId, userId)
        )
      );

    if (existingFeedback.length > 0) {
      // Update existing feedback
      const updatedFeedback = await db
        .update(individualHypothesisFeedback)
        .set({
          rating,
          feedbackText,
          feedbackCategory,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(individualHypothesisFeedback.hypothesisId, hypothesisId),
            eq(individualHypothesisFeedback.userId, userId)
          )
        )
        .returning();

      return updatedFeedback[0];
    } else {
      // Create new feedback
      const newFeedback = await db
        .insert(individualHypothesisFeedback)
        .values({
          hypothesisId,
          userId,
          rating,
          feedbackText,
          feedbackCategory,
        })
        .returning();

      return newFeedback[0];
    }
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to save individual hypothesis feedback',
    );
  }
}

export async function getIndividualHypothesisFeedback({
  hypothesisId,
  userId,
}: {
  hypothesisId: string;
  userId?: string;
}) {
  try {
    if (userId) {
      // Get specific user's feedback
      const feedback = await db
        .select()
        .from(individualHypothesisFeedback)
        .where(
          and(
            eq(individualHypothesisFeedback.hypothesisId, hypothesisId),
            eq(individualHypothesisFeedback.userId, userId)
          )
        );

      return feedback[0] || null;
    } else {
      // Get all feedback for this hypothesis
      const allFeedback = await db
        .select()
        .from(individualHypothesisFeedback)
        .where(eq(individualHypothesisFeedback.hypothesisId, hypothesisId));

      return allFeedback;
    }
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get individual hypothesis feedback',
    );
  }
}

export async function getIndividualHypothesisFeedbackStats({
  hypothesisId,
}: {
  hypothesisId: string;
}) {
  try {
    const stats = await db
      .select({
        rating: individualHypothesisFeedback.rating,
        count: count(),
      })
      .from(individualHypothesisFeedback)
      .where(eq(individualHypothesisFeedback.hypothesisId, hypothesisId))
      .groupBy(individualHypothesisFeedback.rating);

    return stats.reduce((acc, { rating, count }) => {
      acc[rating] = count;
      return acc;
    }, {} as Record<string, number>);
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get individual hypothesis feedback stats',
    );
  }
}

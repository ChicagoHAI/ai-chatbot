-- Example queries for analyzing hypothesis feedback data

-- 1. Get all chats with their hypothesis counts and feedback statistics
SELECT 
    c.id as chat_id,
    c.title as chat_title,
    c."createdAt" as chat_created,
    u.email as user_email,
    COUNT(DISTINCT h.id) as total_hypotheses,
    COUNT(DISTINCT ihf.id) as total_feedback_items,
    AVG(CASE 
        WHEN ihf.rating = 'helpful' THEN 1.0 
        WHEN ihf.rating = 'needs_improvement' THEN 0.5 
        WHEN ihf.rating = 'not_helpful' THEN 0.0 
        ELSE NULL 
    END) as avg_rating_score
FROM "Chat" c
JOIN "User" u ON c."userId" = u.id
LEFT JOIN "Message_v2" m ON c.id = m."chatId"
LEFT JOIN "Hypothesis" h ON m.id = h."messageId"
LEFT JOIN "IndividualHypothesisFeedback" ihf ON h.id = ihf."hypothesisId"
GROUP BY c.id, c.title, c."createdAt", u.email
ORDER BY c."createdAt" DESC;

-- 2. Get hypothesis quality by category
SELECT 
    ihf."feedbackCategory",
    ihf.rating,
    COUNT(*) as feedback_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY ihf."feedbackCategory"), 2) as percentage
FROM "IndividualHypothesisFeedback" ihf
WHERE ihf."feedbackCategory" IS NOT NULL
GROUP BY ihf."feedbackCategory", ihf.rating
ORDER BY ihf."feedbackCategory", ihf.rating;

-- 3. Top rated hypotheses with full context
SELECT 
    h.id as hypothesis_id,
    c.title as chat_title,
    h.title as hypothesis_title,
    h.description as hypothesis_description,
    COUNT(ihf.id) as feedback_count,
    AVG(CASE 
        WHEN ihf.rating = 'helpful' THEN 1.0 
        WHEN ihf.rating = 'needs_improvement' THEN 0.5 
        WHEN ihf.rating = 'not_helpful' THEN 0.0 
    END) as avg_rating,
    STRING_AGG(DISTINCT ihf."feedbackCategory", ', ') as feedback_categories
FROM "Hypothesis" h
JOIN "Message_v2" m ON h."messageId" = m.id
JOIN "Chat" c ON m."chatId" = c.id
LEFT JOIN "IndividualHypothesisFeedback" ihf ON h.id = ihf."hypothesisId"
GROUP BY h.id, c.title, h.title, h.description
HAVING COUNT(ihf.id) > 0
ORDER BY avg_rating DESC, feedback_count DESC
LIMIT 10;

-- 4. User engagement with hypothesis feedback
SELECT 
    u.email as user_email,
    COUNT(DISTINCT c.id) as chats_participated,
    COUNT(DISTINCT h.id) as hypotheses_rated,
    COUNT(ihf.id) as total_ratings,
    ROUND(AVG(CASE 
        WHEN ihf.rating = 'helpful' THEN 1.0 
        WHEN ihf.rating = 'needs_improvement' THEN 0.5 
        WHEN ihf.rating = 'not_helpful' THEN 0.0 
    END), 2) as avg_rating_given
FROM "User" u
JOIN "IndividualHypothesisFeedback" ihf ON u.id = ihf."userId"
JOIN "Hypothesis" h ON ihf."hypothesisId" = h.id
JOIN "Message_v2" m ON h."messageId" = m.id
JOIN "Chat" c ON m."chatId" = c.id
GROUP BY u.id, u.email
ORDER BY total_ratings DESC;

-- 5. Hypothesis feedback trends over time (daily)
SELECT 
    DATE(ihf."createdAt") as feedback_date,
    COUNT(*) as daily_feedback_count,
    AVG(CASE 
        WHEN ihf.rating = 'helpful' THEN 1.0 
        WHEN ihf.rating = 'needs_improvement' THEN 0.5 
        WHEN ihf.rating = 'not_helpful' THEN 0.0 
    END) as daily_avg_rating
FROM "IndividualHypothesisFeedback" ihf
GROUP BY DATE(ihf."createdAt")
ORDER BY feedback_date DESC;
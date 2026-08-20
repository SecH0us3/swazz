-- Migrate legacy string ai_relevance values to boolean integer (1 or 0)
UPDATE findings
SET ai_relevance = CASE
    WHEN ai_relevance IN ('True Positive', 'true_positive', 'true', '1') THEN 1
    WHEN ai_relevance IN ('False Positive', 'false_positive', 'false', '0') THEN 0
    ELSE ai_relevance
END
WHERE ai_relevance IS NOT NULL;

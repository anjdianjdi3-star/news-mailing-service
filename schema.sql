-- Enable UUID extension if not already enabled (Supabase/Neon usually have it enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Subscribers table
CREATE TABLE IF NOT EXISTS subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    days VARCHAR(100) NOT NULL, -- Comma-separated days of week, e.g. "Mon,Wed,Fri" or "1,3,5"
    time VARCHAR(10) NOT NULL,   -- 24h format HH:MM, e.g., "08:00", "13:30"
    keywords VARCHAR(255) NOT NULL, -- Comma-separated search keywords, e.g., "AI,OpenAI,Claude"
    active BOOLEAN NOT NULL DEFAULT TRUE,
    unsubscribe_token VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. RSS Sources table
CREATE TABLE IF NOT EXISTS rss_sources (
    id SERIAL PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    category VARCHAR(100),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Send Logs table
CREATE TABLE IF NOT EXISTS send_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL, -- "success" or "failure"
    article_count INTEGER DEFAULT 0,
    error_message TEXT
);

-- Create indexes for performance on frequent query paths
CREATE INDEX IF NOT EXISTS idx_subscribers_active_schedule ON subscribers (active, time);
CREATE INDEX IF NOT EXISTS idx_send_logs_sent_at ON send_logs (sent_at);
CREATE INDEX IF NOT EXISTS idx_rss_sources_active ON rss_sources (active);

-- Insert some default RSS feed sources for initial setup
INSERT INTO rss_sources (url, category, active) VALUES 
('https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko', 'Google 뉴스 (종합)', true),
('https://rss.donga.com/science.xml', 'IT/과학', true),
('https://rss.donga.com/national.xml', '사회', true)
ON CONFLICT (url) DO NOTHING;

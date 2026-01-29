import { DAO } from './lib/db/index';

async function testRssCrawl() {
    console.log('--- Testing RSS Crawl ---');
    
    // Add a test source
    const testSourceName = 'The Verge';
    const testSourceUrl = 'https://www.theverge.com/rss/index.xml';
    
    try {
        DAO.addRssSource(testSourceUrl, testSourceName);
        console.log(`Added test source: ${testSourceName}`);
    } catch (e) {
        console.log(`Source ${testSourceName} already exists or failed to add.`);
    }

    const sources = DAO.getRssSources();
    console.log('Current sources:', sources);

    // Normally we'd call crawlAllFeeds(), but let's just trigger a worker run
    // for a more realistic test of the whole system.
    console.log('To test the full flow, please run the crawler via the UI or /api/crawl endpoint.');
}

testRssCrawl();

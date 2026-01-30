import pdf from 'pdf-parse';
import axios from 'axios';

async function testPdf() {
  const url = 'https://opensats.org/docs/minutes/2025-Q4.pdf';
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data);
  try {
    const data = await pdf(buffer);
    console.log('Title:', data.info?.Title);
    console.log('Text length:', data.text?.length);
    console.log('Sample text:', data.text?.substring(0, 500));
  } catch (err) {
    console.error('PDF error:', err);
  }
}

testPdf();

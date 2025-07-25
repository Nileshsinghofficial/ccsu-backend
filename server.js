import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import cors from 'cors';

const app = express();
app.use(cors());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/get-result', async (req, res) => {
  const { crsselect, yrselect, textrollnum } = req.body;

  // ✅ Validate input fields
  if (!crsselect || !yrselect || !textrollnum) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // ✅ Roll number: must be numeric & 1–9 digits (leading zero allowed)
  if (!/^\d{1,9}$/.test(textrollnum)) {
    return res.status(400).json({ error: 'Roll number must be numeric and 1–9 digits long' });
  }

  const url = 'https://result.ccsuniversity.ac.in/regpvt2013.php';
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ],
      timeout: 40000
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.select('select[name="crsselect"]', crsselect);
    await page.select('select[name="yrselect"]', yrselect);
    await page.waitForSelector('input[name="textrollnum"]', { timeout: 10000 });
    await page.type('input[name="textrollnum"]', textrollnum);

    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 })
    ]);

    const result = await page.evaluate(() => {
      const getValue = (label) => {
        const tdList = Array.from(document.querySelectorAll('td'));
        for (let i = 0; i < tdList.length; i++) {
          if (tdList[i].innerText.trim() === label && tdList[i + 2]) {
            return tdList[i + 2].innerText.trim();
          }
        }
        return '';
      };

      const extractMarks = () => {
        const tables = document.querySelectorAll('table');
        if (tables.length < 3) return {};

        const rows = tables[2].querySelectorAll('tr');
        if (rows.length < 4) return {};

        const subjectCodes = Array.from(rows[0].querySelectorAll('td')).slice(9).map(td => td.innerText.trim());
        const theoryMarks = Array.from(rows[1].querySelectorAll('td')).slice(9).map(td => td.innerText.trim());
        const internalMarks = Array.from(rows[2].querySelectorAll('td')).slice(9).map(td => td.innerText.trim());
        const vivaMarks = Array.from(rows[3].querySelectorAll('td')).slice(9).map(td => td.innerText.trim());

        const marks = {};
        for (let i = 0; i < subjectCodes.length; i++) {
          const code = subjectCodes[i];
          if (code) {
            marks[code] = {
              theory: theoryMarks[i] || '0',
              practical: internalMarks[i] || '0',
              viva: vivaMarks[i] || '0'
            };
          }
        }
        return marks;
      };

      return {
        candidateName: getValue('Candidate Name'),
        fatherName: getValue("Father's Name"),
        motherName: getValue("Mother's Name"),
        rollNo: getValue('Roll No.'),
        enrolmentNo: getValue('Enrolment No.'),
        college: getValue('College/Institution'),
        marks: extractMarks()
      };
    });

    if (!result.candidateName) {
      return res.json({ error: 'Result not found. Please verify your input.' });
    }

    res.json(result);

  } catch (err) {
    console.error('❌ Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error('❌ Error closing browser:', closeErr);
      }
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

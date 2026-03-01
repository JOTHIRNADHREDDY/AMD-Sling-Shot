import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
app.use(express.json());

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

app.post("/tts", async (req, res) => {
    try {
        const { text, language } = req.body;
        console.log(`TTS request for: ${text} (${language || 'en'})`);

        const sarvamLangMap = {
            'en': 'en-IN',
            'hi': 'hi-IN',
            'te': 'te-IN',
            'ta': 'ta-IN',
            'te-en': 'te-IN',
            'hi-en': 'hi-IN'
        };
        const target_lang = sarvamLangMap[language] || 'en-IN';

        const speakerMap = {
            'te-IN': 'arya',
            'hi-IN': 'arya',
            'ta-IN': 'arya',
            'en-IN': 'arya'
        };
        const speaker = speakerMap[target_lang] || 'arya';

        const response = await axios.post(
            "https://api.sarvam.ai/text-to-speech",
            {
                text: text,
                target_language_code: target_lang,
                speaker: speaker,
                model: "bulbul:v2",
                speech_sample_rate: 22050,
                enable_preprocessing: true
            },
            {
                headers: {
                    "api-subscription-key": SARVAM_API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );

        if (response.data && response.data.audios && response.data.audios.length > 0) {
            const audioBase64 = response.data.audios[0];
            const audioBuffer = Buffer.from(audioBase64, 'base64');

            res.set("Content-Type", "audio/wav");
            res.send(audioBuffer);
        } else {
            throw new Error("No audio returned from Sarvam");
        }

    } catch (error) {
        console.error("TTS Proxy Error:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: "TTS failed",
            details: error.response?.data || error.message
        });
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Sarvam TTS proxy running on port ${PORT}`);
});

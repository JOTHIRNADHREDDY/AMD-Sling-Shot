/**
 * Generate and play speech from text using the Sarvam AI proxy.
 */
export async function generateSpeech(text: string, language: string = 'en') {
    if (!text) return;

    try {
        const response = await fetch("/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, language })
        });

        if (!response.ok) {
            throw new Error(`TTS request failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);

        // Return a promise that resolves when audio finishes playing
        return new Promise((resolve, reject) => {
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                resolve(true);
            };
            audio.onerror = (e) => {
                URL.revokeObjectURL(audioUrl);
                reject(e);
            };
            audio.play().catch(reject);
        });
    } catch (error) {
        console.error("Sarvam TTS error:", error);
    }
}

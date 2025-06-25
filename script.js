const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const readTextBtn = document.getElementById("readTextBtn");

const FOCAL_LENGTH = 600;
const REAL_WIDTHS = {
  person: 0.5,
  chair: 0.5,
  car: 1.8,
  bicycle: 1.5,
  motorbike: 1.5
};

const DIRECTION_PRIORITY = ["ahead", "left", "right"];
const lastSpokenTime = {};
const cooldown = 4000;
let model = null;
let runningDetection = true;

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });
  video.srcObject = stream;
  return new Promise(resolve => {
    video.onloadedmetadata = () => resolve(video);
  });
}

function speak(text) {
  if (!text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function estimateDistance(className, boxWidth) {
  if (REAL_WIDTHS[className]) {
    const dist = (REAL_WIDTHS[className] * FOCAL_LENGTH) / boxWidth;
    return Math.round(dist * 10) / 10;
  }
  return null;
}

// Flip x center for correct left/right because camera is mirrored
function getDirection(x, width, canvasWidth) {
  const center = x + width / 2;
  const flipped = canvasWidth - center; // flip horizontally
  if (flipped < canvasWidth / 3) return "left";
  if (flipped > 2 * canvasWidth / 3) return "right";
  return "ahead";
}

// Call Groq API for smarter comment, with fallback
async function getGroqComment(cls, dist, direction) {
  const prompt = `You are an assistant helping a visually impaired person. An object detected is a ${cls} at approximately ${dist} meters to the ${direction}. Provide a clear, polite, and helpful instruction or comment for the user.`;

  try {
    const response = await fetch("https://api.groq.ai/v1/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "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" // <== Replace here
      },
      body: JSON.stringify({
        model: "groq-v1",
        prompt,
        max_tokens: 60,
        temperature: 0.8,
        stop: ["\n"]
      })
    });
    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].text.trim();
    }
  } catch (e) {
    console.error("Groq API error:", e);
  }
  // Fallback message if API fails
  let fallbackMsg = `${cls}`;
  if (dist) fallbackMsg += ` at about ${dist} meters`;
  fallbackMsg += ` to your ${direction}. Please be careful.`;
  return fallbackMsg;
}

async function describeImportant(predictions) {
  const now = Date.now();
  const filtered = predictions.filter(p => p.class in REAL_WIDTHS && p.bbox[2] > 50);

  for (const dir of DIRECTION_PRIORITY) {
    const relevant = filtered.find(p => getDirection(p.bbox[0], p.bbox[2], canvas.width) === dir);
    if (relevant) {
      const [x, y, width] = relevant.bbox;
      const cls = relevant.class;
      const dist = estimateDistance(cls, width);
      const direction = getDirection(x, width, canvas.width);
      const key = `${cls}-${direction}`;

      if (!lastSpokenTime[key] || now - lastSpokenTime[key] > cooldown) {
        const comment = await getGroqComment(cls, dist, direction);
        speak(comment);
        lastSpokenTime[key] = now;
        break;
      }
    }
  }
}

async function detectFrame() {
  if (!runningDetection) return;

  const predictions = await model.detect(video);
  //console.log("Predictions:", predictions);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  predictions.forEach(pred => {
    const [x, y, width, height] = pred.bbox;
    ctx.strokeStyle = "lime";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    ctx.font = "16px Arial";
    ctx.fillStyle = "lime";
    ctx.fillText(pred.class, x, y > 10 ? y - 5 : y + 15);
  });

  await describeImportant(predictions);

  requestAnimationFrame(detectFrame);
}

async function recognizeTextFromCanvas() {
  runningDetection = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const worker = await Tesseract.createWorker({
    logger: m => console.log(m)
  });
  await worker.loadLanguage("eng");
  await worker.initialize("eng");

  // Draw current video frame on canvas to capture text
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const { data: { text } } = await worker.recognize(canvas);

  if (text && text.trim().length > 2) {
    const lower = text.toLowerCase();
    if (lower.includes("stop")) {
      speak("Stop sign detected. Please stop.");
    } else if (lower.includes("hump") || lower.includes("bump")) {
      speak("Speed bump ahead.");
    } else {
      speak("Detected text: " + text);
    }
  } else {
    speak("No readable text detected.");
  }

  await worker.terminate();

  runningDetection = true;
  detectFrame();
}

// Voice recognition for "read the text" command
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recog = new SpeechRecognition();
  recog.lang = "en-US";
  recog.continuous = false;
  recog.interimResults = false;

  recog.onresult = e => {
    if (e.results[0][0].transcript.toLowerCase().includes("read the text")) {
      speak("Reading text now.");
      recognizeTextFromCanvas();
    }
  };

  recog.onerror = e => console.error("Speech recognition error:", e);

  readTextBtn.onclick = () => {
    recog.start();
  };
} else {
  // No speech recognition support: fallback to button only
  readTextBtn.onclick = () => {
    speak("Reading text now.");
    recognizeTextFromCanvas();
  };
}

async function run() {
  await setupCamera();
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  model = await cocoSsd.load();
  console.log("Model loaded");
  detectFrame();
}

run();

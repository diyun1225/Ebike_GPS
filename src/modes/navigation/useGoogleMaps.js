import { useEffect, useState } from "react";

let loadPromise = null;

// 只載入一次 Google Maps script
function loadGoogleMaps(apiKey) {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve(window.google);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry,places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error("Google Maps 載入失敗，請檢查 API 金鑰"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function useGoogleMaps(apiKey) {
  const [google, setGoogle] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!apiKey || apiKey === "YOUR_API_KEY") {
      setError("尚未設定 API 金鑰，請在 .env 填入 VITE_GOOGLE_MAPS_API_KEY");
      return;
    }
    loadGoogleMaps(apiKey)
      .then((g) => setGoogle(g))
      .catch((e) => setError(e.message));
  }, [apiKey]);

  return { google, error };
}

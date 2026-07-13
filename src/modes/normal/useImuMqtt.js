import { useEffect, useState } from "react";
import mqtt from "mqtt";

// 一般模式的 IMU 即時數據：訂閱樹莓派發上來的 MQTT topic（QoS 0）。
// broker 與地圖同步共用同一顆（.env 的 VITE_MQTT_URL），但各自開自己的連線，
// 進入一般模式才連、離開就斷，不影響導航那條。
// payload 範例：
//   { "source":"imu","timestamp_ms":...,"ax_g":...,"ay_g":...,"az_g":...,
//     "gx_dps":...,"gy_dps":...,"gz_dps":...,"accel_norm_g":...,"roll_deg":...,
//     "heart_rate_bpm":...,"r_rate_bpm":... }
const URL = import.meta.env.VITE_MQTT_URL || "wss://broker.emqx.io:8084/mqtt";
const TOPIC = "ouo/v1/vehicle/state";

export default function useImuMqtt() {
  const [status, setStatus] = useState("connecting"); // connecting | connected | closed
  const [imu, setImu] = useState(null); // 最新一筆 payload（原樣保留欄位）
  const [lastAt, setLastAt] = useState(null); // 本機收到的時間，判斷資料新舊用

  useEffect(() => {
    const client = mqtt.connect(URL, {
      clientId: "app-imu-" + Math.random().toString(16).slice(2, 8),
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 8000,
    });
    client.on("connect", () => {
      setStatus("connected");
      client.subscribe(TOPIC, { qos: 0 });
      console.log("[imuMqtt] 已連線", URL, "訂閱", TOPIC);
    });
    client.on("reconnect", () => setStatus("connecting"));
    client.on("close", () => setStatus("closed"));
    client.on("error", (e) => console.warn("[imuMqtt] 錯誤:", e?.message || e));
    client.on("message", (topic, payload) => {
      if (topic !== TOPIC) return;
      try {
        setImu(JSON.parse(payload.toString()));
        setLastAt(Date.now());
      } catch {
        // 非 JSON 的雜訊封包直接略過
      }
    });
    return () => client.end(true);
  }, []);

  return { status, imu, lastAt };
}

import { gradeColor, fmtDist } from "../slope.js";

export default function SegmentList({ segments, onFocus }) {
  if (!segments.length) return null;

  return (
    <div id="segmentList">
      {segments.map((seg) => {
        const color = gradeColor(seg.grade);
        return (
          <div
            key={seg.index}
            className="seg"
            style={{ borderLeftColor: color }}
            onClick={() => onFocus(seg)}
          >
            <div className="num">{seg.index}</div>
            <div className="info">
              <span className="grade" style={{ color }}>
                {seg.grade >= 0 ? "+" : ""}
                {seg.grade.toFixed(1)}%
              </span>
              <div className="detail">
                {fmtDist(seg.segDist)} ·  高度 {seg.elevChange >= 0 ? "+" : ""}
                {seg.elevChange.toFixed(0)} m
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ODD_SCENE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAGAAAAAAEJTozAAABPElEQVQ4Ec1UwUrEMBCdSdLWXUWKiBdZjx78BM9+jt8jHv0gwYMfICjIohVWbV1jN4kvTa3dkuJJ2CGUTCZv3nTetJyfzJxzhNUZe+u8wUbBT6fbIkkoQJiM1qvPJY1gFNLnh0c7e/vOWoBZiLfHh+L+bozEM/h6uqr6tfnY0MTw4C9/AwH+pRmtEcL3iAibsf40cVIIl89z/b5otWP+qsoxEYDxDNXipVUtJEEO5tqYQYcTKSFmWxL1RsE62lV0fjqbpgoCIQmC2vLF9byodCNcSPzzxJVM8tnxQT5JbcMCwIflq9vClTEAgMDolcXqAGAIFW6gcP9fUqStofFbSkwSaV3zVRFZg5HxjY8ABFNl6PLmKVO/wtWWXpc1QoyfgAeuW9ChPxpIn0lPEmEAFuQoaT1J68VPo1fD4TcudnFm9j2IpwAAAABJRU5ErkJggg==";

const EVEN_SCENE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAGAAAAAAEJTozAAABJElEQVQ4EeVTvU7DMBC+uzhVgAF1KKrECBs8Qd+pL8WjMMPMxl61UifUpgk2n+34MIlVqTOWopy/u+/+zcvHFV1yTDR2ZzmcaT2ByTV8jtKRfCe9gXTf0PrpxogkMHNIZIRfPrv3zbGufCQfAcLdtamlKhJg13i3wxlqACDOKZq0/o+4OR5roJlQLeU6gEtWtYH8Zfl1S5XY3LHKlfD2YJXDmAMi9mVjz4IWXpUwpFSLegxCMTuXupTbWuvmi+bheQFBcWbqWvvxtul7O3RJdcjAzOR2fjUiHA+WwYtz+LWOkiNYjwguBRzlPuZO7/+SMJkD3hMWQTchtClHJgQM9eT2u1YbDwoIp9bG9ffLN232nxcQ9s8P2X/hxRUIQad4frt4cD9rO1p0C00n4gAAAABJRU5ErkJggg==";

function decodeBase64(value) {
  const raw = atob(value);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function shootingRecordBytes() {
  const rows = [
    "롤 이름,번호 밀림 예시",
    "카메라,합성 카메라",
    "렌즈,합성 50mm",
    "필름,합성 컬러 필름",
    "노출 지수(EI),400",
    "번호,조리개,셔터,초점거리,노출 보정,메모",
  ];
  const values = [
    ["5.6", "1/250", "+0.0"],
    ["8", "1/500", "-0.3"],
    ["4", "1/125", "+0.3"],
  ];
  for (let number = 1; number <= 36; number += 1) {
    const [aperture, shutter, compensation] = values[(number - 1) % values.length];
    rows.push(`${number},${aperture},${shutter},50,${compensation},합성 장면 ${String(number).padStart(2, "0")}`);
  }
  return new TextEncoder().encode(`${rows.join("\n")}\n`);
}

export function shiftedRollExampleBytes() {
  if (!globalThis.fflate) throw new Error("ZIP 도구를 불러오지 못했어요.");
  const odd = decodeBase64(ODD_SCENE_BASE64);
  const even = decodeBase64(EVEN_SCENE_BASE64);
  const entries = {};
  for (let number = 3; number <= 38; number += 1) {
    entries[`scan_${String(number).padStart(3, "0")}.png`] = number % 2 === 0 ? even : odd;
  }
  return {
    zipBytes: globalThis.fflate.zipSync(entries, { level: 6, mtime: new Date(Date.UTC(1980, 0, 1)) }),
    recordBytes: shootingRecordBytes(),
  };
}

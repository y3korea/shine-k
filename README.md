# SHine-K 쇼케이스 웹사이트 (shine-k-site)

Sensors (MDPI) 투고 논문 **"Design and Working Prototype of SHine-K: An Edge-AI, Video-Free Web
Platform for Centralized Worker Safety-and-Health Monitoring in SME Manufacturing"** 을 대변하는
정적 웹사이트. 시뮬레이션(디지털 트윈)과 리얼월드 실행(웹캠 엣지 AI)이 **하나의 이벤트 버스**를
공유하는 것이 핵심 설계입니다.

## 페이지 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 논문 내러티브 랜딩 (라이트 테마, KO/EN 토글, 9개 섹션) |
| `console.html` | 관제 콘솔 (다크). 해시 라우팅: `#twin` 시뮬레이션 트윈 · `#live` 웹캠 라이브 · `#agents` 12-에이전트 · `#events` 세션 기록/내보내기 · `#evidence` 논문 근거 |
| `portal.html` | 실서비스 포털 — 기업/관제센터 **데모 로그인** (실제 인증·비밀번호 없음) |
| `worksite.html` | 기업(사업장) 현장 엣지 노드 — 웹캠 REBA·낙상 + 과로 로스터 + Act 루프 휴식 처방 |

## 핵심 파일

- `js/shinek-core.js` — **논문에서 URFD로 검증한 낙상/무동작 상태머신(FallSM)의 JS 포트**
  (배포 임계값 그대로: tilt 52°, aspect 1.0, 700ms 확인, 12s 무동작) + 간이 REBA + 평가 결과 데이터.
- `js/sim.js` — 디지털 트윈 엔진. 시뮬레이션 워커의 COCO-17 스켈레톤을 생성해 **실제 FallSM에 통과**시킴
  (시뮬과 라이브가 문자 그대로 동일 파이프라인). 시드 PRNG(mulberry32, seed 20260722)로 결정론적.
- `js/live.js` — TF.js + MoveNet MultiPose(논문과 동일 모델) 웹캠 추론. 카메라 불가 시 합성 REPLAY 폴백.
- `js/console.js` · `js/worksite.js` · `js/landing.js` · `js/auth.js`(데모 세션) · `css/tokens.css`(디자인 토큰)

## 실행

```bash
python3 -m http.server 8765 --directory shine-k-site
```

- 웹캠(LIVE)은 `localhost` 또는 **https** 환경에서만 동작합니다(브라우저 보안 정책).
- 외부 CDN 2종만 사용: Pretendard/JetBrains Mono 폰트, TF.js(라이브 진입 시 지연 로드).
- 배포: 폴더 전체를 Netlify/GitHub Pages/Vercel에 그대로 업로드하면 됩니다.

## 정직성 규칙 (논문 Table 2와 일치)

- 모든 화면에 SIMULATION / LIVE / REPLAY / DESIGN-STAGE 배지를 상시 표기.
- 측정 결과(URFD recall 1.00·F1 0.84)는 항상 8시퀀스 랩 부분집합 주의사항과 함께 표기.
- 119/e-Gen·레이더/열화상·12-에이전트·비즈니스 지표는 "설계 목표"로만 표기 — 결과처럼 보이지 않게.
- 특허 9건은 "patent-pending"으로만 표기(임의 번호 없음).
- 데모 포털은 비밀번호를 요구하지 않으며 개인정보를 수집하지 않음.

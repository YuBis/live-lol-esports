# 📊 Live LoL Esports (YuBis Fork) - Forked from [andydanger](https://github.com/andydanger/live-lol-esports)
실시간 LoL Esports 경기를 보기 좋은 중계 HUD 형태로 시각화한 프로젝트입니다.
원본을 기반으로 한국어 로컬라이징, UI 가독성, 아이템 복구 안정성을 집중적으로 개선했습니다.

# 🔑 Key Differences

## 1) 한국어/표현 개선
- 경기 상태, 탭/라벨 등 주요 UI 텍스트 한국어화
- 한국어 챔피언/룬/아이템 데이터 사용 강화
- Pretendard 폰트 적용 및 텍스트 가독성 개선

## 2) 경기 HUD/레이아웃 개선
- 킬/골드/오브젝트 정보 가독성 개선
- 골드 우세 표시 방식 개편
- 중계 화면 정렬 문제 및 상태 배지 표현 개선

## 3) 스케줄/매치 리스트 UX 개선
- 리그 필터
- 상태 배지/시리즈(BO) 표현 개선
- 목록 사용성 개선

## 4) 아이템 안정화/복구 로직 고도화
- LiveStats 누락 프레임 대응(backfill) 로직 강화
- 신발/여눈 계열 업그레이드 추론 및 중복/역행 보정
- 장신구/소모품 처리 규칙 정교화
- 제어 와드 유지, 소모성 아이템 과표시 방지

## 📦 Dependencies and programs used

| Name                                             | Use in project                                               |
| ------------------------------------------------ | ------------------------------------------------------------ |
| [Visual Studio Code](https://code.visualstudio.com/)        | IDE |
| [React](https://reactjs.org/) | FrameWork |
| [Unofficial Lolesports API](https://github.com/vickz84259/lolesports-api-docs) | Requesting live data [vickz84259](https://github.com/vickz84259) |

const dayFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'full',
  timeZone: 'Asia/Seoul',
});

const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

async function getMarketSnapshot() {
  // TODO: 공개 API 연동 시 이 함수 내부를 fetch(...) 호출로 교체하세요.
  // 예: 한국은행 ECOS(기준금리, 국고채), 공공데이터포털/서울외국환중개(환율),
  // 한국거래소 정보데이터시스템(코스피) 응답을 아래 카드 구조로 매핑합니다.
  return {
    updatedAt: new Date(),
    items: [
      {
        label: '기준금리',
        value: '2.75%',
        change: '전월 대비 0.00%p',
        status: '동결',
        note: '한국은행 기준',
        tone: 'neutral',
        accent: '#fcd535',
        accentSoft: 'rgba(252, 213, 53, 0.14)',
        sparkline: '4,22 22,22 40,22 58,22 76,22 94,22',
      },
      {
        label: '원/달러 환율',
        value: '1,380원',
        change: '+4.20원',
        status: '상승',
        note: '서울 외환시장',
        tone: 'up',
        accent: '#0ecb81',
        accentSoft: 'rgba(14, 203, 129, 0.14)',
        sparkline: '4,24 22,21 40,23 58,16 76,18 94,11',
      },
      {
        label: '코스피',
        value: '2,765.40',
        change: '-0.36%',
        status: '하락',
        note: '장중 더미 지수',
        tone: 'down',
        accent: '#f6465d',
        accentSoft: 'rgba(246, 70, 93, 0.14)',
        sparkline: '4,10 22,14 40,12 58,18 76,21 94,24',
      },
      {
        label: '국고채 3년',
        value: '2.83%',
        change: '+0.03%p',
        status: '상승',
        note: '민평금리 기준',
        tone: 'up',
        accent: '#0ecb81',
        accentSoft: 'rgba(14, 203, 129, 0.14)',
        sparkline: '4,24 22,20 40,21 58,17 76,14 94,15',
      },
    ],
  };
}

function metricCardTemplate(item) {
  return `
    <article
      class="metric-card"
      style="--accent: ${item.accent}; --accent-soft: ${item.accentSoft};"
    >
      <div class="metric-card-inner">
        <div class="metric-topline">
          <h2 class="metric-label">${item.label}</h2>
          <span class="metric-status">${item.status}</span>
        </div>
        <p class="metric-value">${item.value}</p>
        <div class="metric-detail">
          <div>
            <span class="metric-change metric-change--${item.tone}">${item.change}</span>
            <svg class="sparkline" viewBox="0 0 98 34" aria-hidden="true">
              <polyline points="${item.sparkline}" />
            </svg>
          </div>
          <span class="metric-note">${item.note}</span>
        </div>
      </div>
    </article>
  `;
}

async function renderDashboard() {
  const snapshot = await getMarketSnapshot();
  const todayLabel = document.querySelector('#today-label');
  const updatedLabel = document.querySelector('#updated-label');
  const metricGrid = document.querySelector('#metric-grid');

  todayLabel.textContent = dayFormatter.format(snapshot.updatedAt);
  updatedLabel.textContent = `${timeFormatter.format(snapshot.updatedAt)} 기준`;
  metricGrid.innerHTML = snapshot.items.map(metricCardTemplate).join('');
}

renderDashboard();

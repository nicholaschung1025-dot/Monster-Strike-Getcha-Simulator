let chartInstance = null;

function switchTab(tabId, event) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    event.target.classList.add('active');
}

// --- Mode 1: 固定隻數求抽數 (CDF) ---
function calculateMode1() {
    let btn = document.getElementById('btnMode1');
    btn.innerText = "運算中...";
    btn.disabled = true;

    // 使用 setTimeout 讓瀏覽器有時間更新按鈕文字，避免畫面凍結
    setTimeout(() => {
        let rate = parseFloat(document.getElementById('targetRate').value);
        let startShards = parseInt(document.getElementById('currentShards').value) || 0;
        let targetCopies = parseInt(document.getElementById('targetCopies').value) || 1;
        
        // 讀取使用者選擇的模擬次數
        let iterations = parseInt(document.getElementById('simCount').value) || 1000000; 
        document.getElementById('dispSimCount1').innerText = iterations.toLocaleString();
        
        let results = new Int32Array(iterations);
        let htRate = rate / 12.0 * 100;
        
        for (let i = 0; i < iterations; i++) {
            let hits = 0;
            let pulls = 0;
            let s = startShards;
            
            while (hits < targetCopies) {
                pulls++;
                let rand = Math.random() * 100;
                
                if (rand < rate) {
                    hits++; 
                } else if (rand >= 12.0) {
                    s++; 
                    if (s >= 50) {
                        s = 0; 
                        if ((Math.random() * 100) < htRate) {
                            hits++;
                        }
                    }
                }
            }
            results[i] = pulls;
        }

        results.sort();

        let p25 = results[Math.floor(iterations * 0.25)];
        let p50 = results[Math.floor(iterations * 0.50)];
        let p85 = results[Math.floor(iterations * 0.85)];
        let p99 = results[Math.floor(iterations * 0.99)];

        document.getElementById('stat25').innerText = p25;
        document.getElementById('stat50').innerText = p50;
        document.getElementById('stat85').innerText = p85;
        document.getElementById('stat99').innerText = p99;

        let maxPulls = results[Math.floor(iterations * 0.995)]; 
        let cdfData = new Array(maxPulls + 1).fill(0);
        let resIdx = 0;
        for (let p = 1; p <= maxPulls; p++) {
            while (resIdx < iterations && results[resIdx] <= p) {
                resIdx++;
            }
            cdfData[p] = (resIdx / iterations) * 100;
        }

        document.getElementById('mode1Results').style.display = 'block';
        updateCdfChart(cdfData, maxPulls, targetCopies);
        renderMilestoneTable(results, iterations);

        btn.innerText = "🚀 執行模擬";
        btn.disabled = false;
    }, 50); 
}

function updateCdfChart(cdfData, maxPulls, copies) {
    let labels = [];
    let data = [];
    for (let i = 1; i <= maxPulls; i++) {
        labels.push(i);
        data.push(cdfData[i]);
    }

    const ctx = document.getElementById('cdfChart').getContext('2d');
    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `獲得 ${copies} 隻的達成率 (%)`,
                data: data,
                backgroundColor: 'rgba(46, 125, 50, 0.1)',
                borderColor: 'rgba(46, 125, 50, 1)',
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { title: { display: true, text: '累積抽數' }, grid: { display: false } },
                y: { title: { display: true, text: '達成率 (%)' }, min: 0, max: 100, ticks: { callback: v => v + '%' } }
            }
        }
    });
}

function renderMilestoneTable(sortedResults, iterations) {
    const percentiles = [10, 25, 50, 75, 85, 90, 95, 99];
    const remarks = {
        10: "天選之子 (超幸運)",
        25: "運氣極佳",
        50: "中位數 (一般水準)",
        75: "運氣偏弱",
        85: "多數玩家的保底極限",
        90: "開始進入非酋領域",
        95: "嚴重非酋",
        99: "幾乎 100% 絕對能出貨的防線"
    };

    const tbody = document.querySelector('#milestoneTable tbody');
    tbody.innerHTML = '';

    percentiles.forEach(p => {
        let idx = Math.floor(iterations * (p / 100));
        if (idx >= iterations) idx = iterations - 1;
        let pulls = sortedResults[idx];
        
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: bold; color: #1976d2;">${p}%</td>
            <td>${pulls} 抽 <span style="color:#888; font-size:12px;">(${pulls * 5} 寶珠)</span></td>
            <td>${remarks[p]}</td>
        `;
        tbody.appendChild(tr);
    });
}

// --- Mode 2: 固定抽數求隻數 (PDF) ---
function calculateMode2() {
    let btn = document.getElementById('btnMode2');
    btn.innerText = "運算中...";
    btn.disabled = true;

    setTimeout(() => {
        let rate = parseFloat(document.getElementById('targetRate').value);
        let startShards = parseInt(document.getElementById('currentShards').value) || 0;
        let maxPulls = parseInt(document.getElementById('simPulls').value) || 100;
        
        let iterations = parseInt(document.getElementById('simCount').value) || 1000000; 
        document.getElementById('dispSimCount2').innerText = iterations.toLocaleString();
        
        let resultCounts = {}; 
        let totalHitsAcrossSims = 0;
        let htRate = rate / 12.0 * 100;

        for (let i = 0; i < iterations; i++) {
            let hits = 0;
            let s = startShards;
            for (let p = 0; p < maxPulls; p++) {
                let rand = Math.random() * 100;
                if (rand < rate) {
                    hits++;
                } else if (rand >= 12.0) {
                    s++;
                    if (s >= 50) {
                        s = 0;
                        if ((Math.random() * 100) < htRate) hits++;
                    }
                }
            }
            resultCounts[hits] = (resultCounts[hits] || 0) + 1;
            totalHitsAcrossSims += hits;
        }

        document.getElementById('mode2Results').style.display = 'block';
        document.getElementById('resPulls').innerText = maxPulls;
        document.getElementById('resAvg').innerText = (totalHitsAcrossSims / iterations).toFixed(2);

        let tbody = document.querySelector('#distTable tbody');
        tbody.innerHTML = '';

        let maxHitsToShow = Math.max(...Object.keys(resultCounts).map(Number));
        if (maxHitsToShow > 10) maxHitsToShow = 10; 

        let cumulativeProb = 100.0; 
        let groupedOver10 = 0;

        for (let k = 0; k <= maxHitsToShow; k++) {
            let count = resultCounts[k] || 0;
            if (k === 10) {
                for(let key in resultCounts) if(Number(key) >= 10) groupedOver10 += resultCounts[key];
                count = groupedOver10;
            }
            
            let prob = (count / iterations) * 100;
            let label = k === 10 ? "10 隻以上" : `${k} 隻`;
            
            let tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${label}</strong></td>
                <td>${prob.toFixed(3)}%</td>
                <td><div class="bar-chart" style="width: ${Math.max(0.5, Math.min(prob, 100))}%;"></div></td>
                <td style="color: #d32f2f; font-weight: bold;">${k===0 ? "100.00" : cumulativeProb.toFixed(3)}%</td>
            `;
            tbody.appendChild(tr);
            cumulativeProb -= prob; 
        }
        
        btn.innerText = "🚀 執行模擬";
        btn.disabled = false;
    }, 50); 
}

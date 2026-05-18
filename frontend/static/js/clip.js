/* ============================================
   CLIP Classifier JavaScript - CLIP 분류기 로직
   ============================================ */

// DOM Elements - Single Mode
const imageAInput = document.getElementById('imageAInput');
const imageAArea = document.getElementById('imageAArea');
const imageAPreview = document.getElementById('imageAPreview');
const imageAImg = document.getElementById('imageAImg');
const removeImageA = document.getElementById('removeImageA');
const imageAInfo = document.getElementById('imageAInfo');

const folderPath = document.getElementById('folderPath');
const targetFolder = document.getElementById('targetFolder');
const threshold = document.getElementById('threshold');
const thresholdValue = document.getElementById('thresholdValue');

// DOM Elements - Multi Mode
const multiFolderPath = document.getElementById('multiFolderPath');
const refImagesList = document.getElementById('refImagesList');
const addRefBtn = document.getElementById('addRefBtn');
const refImageCardTemplate = document.getElementById('refImageCardTemplate');

// Mode sections
const singleModeSection = document.getElementById('singleModeSection');
const multiModeSection = document.getElementById('multiModeSection');
const modeTabs = document.querySelectorAll('.mode-tab');

// Threshold controls
const singleThresholdControl = document.getElementById('singleThresholdControl');
const multiThresholdInfo = document.getElementById('multiThresholdInfo');

const analyzeBtn = document.getElementById('analyzeBtn');
const classifyBtn = document.getElementById('classifyBtn');

// Progress elements
const progressSection = document.getElementById('progressSection');
const progressTitle = document.getElementById('progressTitle');
const progressFill = document.getElementById('progressFill');
const progressCurrent = document.getElementById('progressCurrent');
const progressTotal = document.getElementById('progressTotal');
const progressPercent = document.getElementById('progressPercent');
const progressPhase = document.getElementById('progressPhase');

// Results sections
const resultsSection = document.getElementById('resultsSection');
const multiResultsSection = document.getElementById('multiResultsSection');
const classifyResults = document.getElementById('classifyResults');

// State
let currentMode = 'single'; // 'single' or 'multi'
let imageAFile = null;
let analysisData = null;
let resultId = null;
let distributionChart = null;
let pollInterval = null;

// Multi-mode state
let refImages = []; // [{file: File, folder: string, threshold: number, previewUrl: string}]
let multiAnalysisData = null;

// Store multi-mode charts
let multiCharts = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    addInitialRefImage();
    updateButtonStates();
});

function setupEventListeners() {
    // Mode tabs (mobile)
    modeTabs.forEach(tab => {
        tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    });

    // Single mode - Image A upload
    if (imageAArea) {
        imageAArea.addEventListener('click', () => imageAInput.click());
        CommonUtils.setupDragDrop(imageAArea, handleImageADrop);
    }
    
    if (imageAInput) {
        imageAInput.addEventListener('change', handleImageASelect);
    }
    
    if (removeImageA) {
        removeImageA.addEventListener('click', (e) => {
            e.stopPropagation();
            clearImageA();
        });
    }

    // Threshold slider
    if (threshold) {
        threshold.addEventListener('input', handleThresholdChange);
    }

    // Buttons
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', handleAnalyze);
    }
    
    if (classifyBtn) {
        classifyBtn.addEventListener('click', handleClassify);
    }

    // Search and sort
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');
    
    if (searchInput) {
        searchInput.addEventListener('input', filterImageList);
    }
    
    if (sortSelect) {
        sortSelect.addEventListener('change', sortImageList);
    }

    // Folder path inputs
    if (folderPath) {
        folderPath.addEventListener('input', updateButtonStates);
        folderPath.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleAnalyze();
        });
    }

    if (multiFolderPath) {
        multiFolderPath.addEventListener('input', updateButtonStates);
    }

    // Multi mode - Add reference image button
    if (addRefBtn) {
        addRefBtn.addEventListener('click', addRefImage);
    }
}

// ============================================
// Mode Switching
// ============================================

function switchMode(mode) {
    currentMode = mode;
    
    // Update tab styles (mobile)
    modeTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    
    // Show/hide sections based on mode
    if (singleModeSection) singleModeSection.hidden = (mode !== 'single');
    if (multiModeSection) multiModeSection.hidden = (mode !== 'multi');
    
    // Show/hide threshold controls
    if (singleThresholdControl) singleThresholdControl.hidden = (mode !== 'single');
    if (multiThresholdInfo) multiThresholdInfo.hidden = (mode !== 'multi');
    
    // Clear results
    if (resultsSection) resultsSection.hidden = true;
    if (multiResultsSection) multiResultsSection.hidden = true;
    if (classifyResults) classifyResults.hidden = true;
    
    // Reset state
    analysisData = null;
    multiAnalysisData = null;
    resultId = null;
    if (classifyBtn) classifyBtn.disabled = true;
    
    updateButtonStates();
}

// ============================================
// Single Mode - Image A handlers
// ============================================

function handleImageASelect(e) {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
        setImageA(file);
    }
}

function handleImageADrop(e) {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        setImageA(file);
    }
}

function setImageA(file) {
    imageAFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        imageAImg.src = e.target.result;
        imageAPreview.hidden = false;
        imageAArea.classList.add('has-file');
        imageAArea.querySelector('.upload-content').hidden = true;
    };
    reader.readAsDataURL(file);

    imageAInfo.textContent = file.name;
    updateButtonStates();
}

function clearImageA() {
    imageAFile = null;
    imageAInput.value = '';
    imageAPreview.hidden = true;
    imageAArea.classList.remove('has-file');
    imageAArea.querySelector('.upload-content').hidden = false;
    imageAInfo.textContent = '';
    updateButtonStates();
    clearResults();
}

// ============================================
// Multi Mode - Reference Images
// ============================================

function addInitialRefImage() {
    if (refImagesList) {
        addRefImage();
    }
}

function addRefImage() {
    if (!refImageCardTemplate) return;
    
    const template = refImageCardTemplate.content.cloneNode(true);
    const card = template.querySelector('.ref-image-card');
    const index = refImages.length;
    
    card.dataset.refIndex = index;
    card.querySelector('.ref-card-number').textContent = `#${index + 1}`;
    
    const fileInput = card.querySelector('input[type="file"]');
    const uploadArea = card.querySelector('.ref-upload-area');
    const preview = card.querySelector('.ref-preview');
    const previewImg = preview.querySelector('img');
    const uploadContent = card.querySelector('.ref-upload-content');
    const folderInput = card.querySelector('.ref-folder');
    const fileName = card.querySelector('.ref-file-name');
    const removeBtn = card.querySelector('.ref-remove-btn');
    const thresholdSlider = card.querySelector('.ref-threshold');
    const thresholdValueDisplay = card.querySelector('.ref-threshold-value');
    
    // Initialize ref image data
    refImages.push({
        file: null,
        folder: '',
        threshold: 70,
        previewUrl: null
    });
    
    // Event listeners
    uploadArea.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                previewImg.src = ev.target.result;
                preview.hidden = false;
                uploadContent.hidden = true;
                uploadArea.classList.add('has-file');
                fileName.textContent = file.name;
                
                refImages[index].file = file;
                refImages[index].previewUrl = ev.target.result;
            };
            reader.readAsDataURL(file);
            updateButtonStates();
        }
    });
    
    // Drag and drop
    CommonUtils.setupDragDrop(uploadArea, (e) => {
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                previewImg.src = ev.target.result;
                preview.hidden = false;
                uploadContent.hidden = true;
                uploadArea.classList.add('has-file');
                fileName.textContent = file.name;
                
                refImages[index].file = file;
                refImages[index].previewUrl = ev.target.result;
            };
            reader.readAsDataURL(file);
            updateButtonStates();
        }
    });
    
    folderInput.addEventListener('input', (e) => {
        refImages[index].folder = e.target.value;
        updateButtonStates();
    });
    
    // Threshold slider for this reference image
    thresholdSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        refImages[index].threshold = parseFloat(val);
        thresholdValueDisplay.textContent = `${val}%`;
        
        // Update results display if available
        if (multiAnalysisData) {
            updateMultiThresholdDisplay();
        }
    });
    
    removeBtn.addEventListener('click', () => {
        if (refImages.length > 1) {
            removeRefImage(index);
        } else {
            alert('최소 1개의 기준 이미지가 필요합니다.');
        }
    });
    
    // 폴더 브라우저 버튼 연결
    setupRefCardBrowseButton(card, index);
    
    refImagesList.appendChild(card);
    updateRefCardNumbers();
    updateButtonStates();
}

function removeRefImage(index) {
    // Remove from DOM
    const card = refImagesList.querySelector(`[data-ref-index="${index}"]`);
    if (card) {
        card.remove();
    }
    
    // Remove from array
    refImages.splice(index, 1);
    
    // Update indices
    const cards = refImagesList.querySelectorAll('.ref-image-card');
    cards.forEach((card, i) => {
        card.dataset.refIndex = i;
    });
    
    updateRefCardNumbers();
    updateButtonStates();
}

function updateRefCardNumbers() {
    const cards = refImagesList.querySelectorAll('.ref-image-card');
    cards.forEach((card, i) => {
        card.querySelector('.ref-card-number').textContent = `#${i + 1}`;
    });
}

function getValidRefImages() {
    return refImages.filter(ref => ref.file && ref.folder.trim());
}

// ============================================
// Button States
// ============================================

function updateButtonStates() {
    let canAnalyze = false;
    
    if (currentMode === 'single') {
        canAnalyze = imageAFile && folderPath && folderPath.value.trim();
    } else {
        const validRefs = getValidRefImages();
        canAnalyze = validRefs.length > 0 && multiFolderPath && multiFolderPath.value.trim();
    }
    
    if (analyzeBtn) analyzeBtn.disabled = !canAnalyze;
}

// ============================================
// Threshold Handler
// ============================================

function handleThresholdChange() {
    if (thresholdValue) thresholdValue.textContent = `${threshold.value}%`;
    
    if (currentMode === 'single' && analysisData) {
        updateThresholdDisplay();
    }
}

// ============================================
// Analysis Handler
// ============================================

async function handleAnalyze() {
    if (currentMode === 'single') {
        await handleSingleAnalyze();
    } else {
        await handleMultiAnalyze();
    }
}

// Single Mode Analysis
async function handleSingleAnalyze() {
    if (!imageAFile) {
        alert('기준 이미지를 업로드해주세요.');
        return;
    }

    const folder = folderPath.value.trim();
    if (!folder) {
        alert('비교할 폴더 경로를 입력해주세요.');
        folderPath.focus();
        return;
    }

    analyzeBtn.disabled = true;
    showProgressSection('이미지 목록 확인 중...');

    try {
        const formData = new FormData();
        formData.append('imageA', imageAFile);
        formData.append('folderPath', folder);

        const startResponse = await fetch('/analyze/start', {
            method: 'POST',
            body: formData
        });

        const startData = await startResponse.json();

        if (startData.error) {
            throw new Error(startData.error);
        }

        const taskId = startData.taskId;
        updateProgressSection('CLIP으로 이미지 분석 중...', 0, startData.total, 0);
        pollProgress(taskId, 'single');

    } catch (error) {
        alert('분석 중 오류가 발생했습니다: ' + error.message);
        hideProgressSection();
        updateButtonStates();
    }
}

// Multi Mode Analysis
async function handleMultiAnalyze() {
    const validRefs = getValidRefImages();
    
    if (validRefs.length === 0) {
        alert('최소 1개의 기준 이미지와 폴더를 설정해주세요.');
        return;
    }

    const folder = multiFolderPath.value.trim();
    if (!folder) {
        alert('비교할 폴더 경로를 입력해주세요.');
        multiFolderPath.focus();
        return;
    }

    const classifyMode = 'best_match';  // 최고 유사도 분류만 사용

    analyzeBtn.disabled = true;
    showProgressSection('기준 이미지 처리 중...');
    updateProgressPhase('기준 이미지 임베딩 계산');

    try {
        const formData = new FormData();
        formData.append('folderPath', folder);
        formData.append('classifyMode', classifyMode);

        // Add all reference images with their thresholds
        validRefs.forEach((ref, idx) => {
            formData.append(`refImage_${idx}`, ref.file);
            formData.append(`refFolder_${idx}`, ref.folder);
            formData.append(`refThreshold_${idx}`, ref.threshold);
        });

        const startResponse = await fetch('/multi-analyze/start', {
            method: 'POST',
            body: formData
        });

        const startData = await startResponse.json();

        if (startData.error) {
            throw new Error(startData.error);
        }

        const taskId = startData.taskId;
        updateProgressSection(
            `다중 분석 중 (기준 ${startData.refCount}개)...`,
            0,
            startData.total + startData.refCount,
            0
        );
        pollProgress(taskId, 'multi');

    } catch (error) {
        alert('분석 중 오류가 발생했습니다: ' + error.message);
        hideProgressSection();
        updateButtonStates();
    }
}

// Progress Polling
let pollRetryCount = 0;
const MAX_POLL_RETRIES = 5;

function pollProgress(taskId, mode) {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
    
    pollRetryCount = 0;

    const endpoint = mode === 'single' 
        ? `/analyze/progress/${taskId}`
        : `/multi-analyze/progress/${taskId}`;

    const doPoll = async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃
            
            const response = await fetch(endpoint, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // 성공시 재시도 카운트 리셋
            pollRetryCount = 0;

            if (data.error && data.status !== 'error') {
                throw new Error(data.error);
            }

            // Update phase for multi mode
            if (mode === 'multi' && data.phase) {
                const phaseText = data.phase === 'reference' 
                    ? '기준 이미지 임베딩 계산'
                    : '비교 이미지 분석';
                updateProgressPhase(phaseText);
            }

            updateProgressSection(
                mode === 'single' ? 'CLIP으로 이미지 분석 중...' : '다중 분석 중...',
                data.current,
                data.total,
                data.percent,
                data.batchSize
            );

            if (data.status === 'complete') {
                clearInterval(pollInterval);
                pollInterval = null;

                if (mode === 'single') {
                    analysisData = data;
                    resultId = data.resultId;
                    hideProgressSection();
                    displayResults(data);
                } else {
                    multiAnalysisData = data;
                    resultId = data.resultId;
                    hideProgressSection();
                    displayMultiResults(data);
                }
                
                classifyBtn.disabled = false;
                updateButtonStates();

            } else if (data.status === 'error') {
                clearInterval(pollInterval);
                pollInterval = null;
                throw new Error(data.error || '분석 중 오류 발생');
            }

        } catch (error) {
            pollRetryCount++;
            console.warn(`[Polling] 오류 발생 (${pollRetryCount}/${MAX_POLL_RETRIES}):`, error.message);
            
            // 연결 오류는 재시도
            if (pollRetryCount < MAX_POLL_RETRIES && 
                (error.name === 'AbortError' || error.message.includes('fetch') || error.message.includes('network'))) {
                console.log('[Polling] 재시도 대기 중...');
                // 재시도 간격 증가 (백오프)
                return;
            }
            
            clearInterval(pollInterval);
            pollInterval = null;
            alert('분석 중 오류가 발생했습니다: ' + error.message);
            hideProgressSection();
            updateButtonStates();
        }
    };
    
    // 즉시 첫 번째 폴링 실행
    doPoll();
    
    // 1초 간격으로 폴링 (기존 500ms에서 증가)
    pollInterval = setInterval(doPoll, 1000);
}

// ============================================
// Progress UI
// ============================================

function showProgressSection(title) {
    if (progressSection) progressSection.hidden = false;
    if (progressTitle) progressTitle.textContent = title;
    if (progressFill) progressFill.style.width = '0%';
    if (progressCurrent) progressCurrent.textContent = '0';
    if (progressTotal) progressTotal.textContent = '0';
    if (progressPercent) progressPercent.textContent = '0';
    if (progressPhase) progressPhase.textContent = '';
    
    if (resultsSection) resultsSection.hidden = true;
    if (multiResultsSection) multiResultsSection.hidden = true;
    if (classifyResults) classifyResults.hidden = true;
}

function updateProgressSection(title, current, total, percent, batchSize = null) {
    if (progressTitle) progressTitle.textContent = title;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressCurrent) progressCurrent.textContent = current.toLocaleString();
    if (progressTotal) progressTotal.textContent = total.toLocaleString();
    if (progressPercent) progressPercent.textContent = percent.toFixed(1);
    
    // 배치 사이즈 표시
    if (batchSize && batchSize > 1) {
        const batchInfo = document.getElementById('batchInfo');
        if (batchInfo) {
            batchInfo.textContent = `배치: ${batchSize}`;
            batchInfo.hidden = false;
        }
    }
}

function updateProgressPhase(phase) {
    if (progressPhase) progressPhase.textContent = phase;
}

function hideProgressSection() {
    if (progressSection) progressSection.hidden = true;
    const batchInfo = document.getElementById('batchInfo');
    if (batchInfo) {
        batchInfo.hidden = true;
    }
}

// ============================================
// Classification Handler
// ============================================

async function handleClassify() {
    if (currentMode === 'single') {
        await handleSingleClassify();
    } else {
        await handleMultiClassify();
    }
}

// Single Mode Classification
async function handleSingleClassify() {
    if (!resultId) {
        alert('먼저 분석을 실행해주세요.');
        return;
    }

    const target = targetFolder.value.trim();
    if (!target) {
        alert('분류 대상 폴더 경로를 입력해주세요.');
        targetFolder.focus();
        return;
    }

    const thresholdVal = parseFloat(threshold.value);
    const totalAbove = getAboveThresholdCount(thresholdVal);

    const moveMode = document.querySelector('input[name="moveMode"]:checked').value;
    const action = moveMode === 'move' ? '이동' : '복사';

    if (totalAbove === 0) {
        alert('임계치 이상의 유사도를 가진 이미지가 없습니다.');
        return;
    }

    if (!confirm(`${totalAbove}개의 이미지를 ${action}하시겠습니까?`)) {
        return;
    }

    CommonUtils.showLoading(`이미지 ${action} 중...`);

    try {
        const response = await fetch('/classify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                threshold: thresholdVal,
                resultId: resultId,
                targetFolder: target,
                moveMode: moveMode
            })
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        displayClassifyResults(data, action);

    } catch (error) {
        alert('분류 중 오류가 발생했습니다: ' + error.message);
    } finally {
        CommonUtils.hideLoading();
    }
}

// Multi Mode Classification
async function handleMultiClassify() {
    if (!resultId) {
        alert('먼저 분석을 실행해주세요.');
        return;
    }

    const classifyMode = 'best_match';  // 최고 유사도 분류만 사용
    const moveMode = document.querySelector('input[name="moveMode"]:checked').value;
    
    const action = moveMode === 'move' ? '이동' : '복사';
    
    // Get individual thresholds from refImages
    const validRefs = getValidRefImages();
    const thresholds = {};
    validRefs.forEach((ref, idx) => {
        thresholds[idx] = ref.threshold;
    });
    
    // Calculate total files to be moved (based on individual thresholds)
    const totalAbove = getMultiAboveThresholdCountIndividual();
    
    if (totalAbove === 0) {
        alert('임계치 이상의 유사도를 가진 이미지가 없습니다.');
        return;
    }

    if (!confirm(`${totalAbove}개의 이미지를 최고 유사도 기준으로 ${action}하시겠습니까?`)) {
        return;
    }

    CommonUtils.showLoading(`이미지 ${action} 중...`);

    try {
        const response = await fetch('/multi-classify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                resultId: resultId,
                moveMode: moveMode,
                classifyMode: classifyMode,
                thresholds: thresholds
            })
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        displayMultiClassifyResults(data, action);

    } catch (error) {
        alert('분류 중 오류가 발생했습니다: ' + error.message);
    } finally {
        CommonUtils.hideLoading();
    }
}

// ============================================
// Single Mode Results Display
// ============================================

function displayResults(data) {
    resultsSection.hidden = false;
    multiResultsSection.hidden = true;
    classifyResults.hidden = true;

    const totalCount = data.totalCount || data.stats.count;
    document.getElementById('totalCount').textContent = totalCount.toLocaleString();
    document.getElementById('meanValue').textContent = `${data.stats.mean}%`;
    document.getElementById('maxValue').textContent = `${data.stats.max}%`;
    document.getElementById('minValue').textContent = `${data.stats.min}%`;
    document.getElementById('stdValue').textContent = data.stats.std.toFixed(2);

    updateThresholdDisplay();
    drawDistributionChart(data.similarities);
    renderImageList(data.similarities);

    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function getAboveThresholdCount(thresholdVal) {
    if (!analysisData) return 0;
    
    if (analysisData.thresholdCounts) {
        const thresh = Math.floor(thresholdVal);
        return analysisData.thresholdCounts[thresh] || 0;
    } else {
        const above = analysisData.similarities.filter(s => s.similarity >= thresholdVal).length;
        const totalCount = analysisData.totalCount || analysisData.stats.count;
        const ratio = totalCount / analysisData.similarities.length;
        return Math.round(above * ratio);
    }
}

function updateThresholdDisplay() {
    if (!analysisData) return;

    const thresholdVal = parseFloat(threshold.value);
    const totalCount = analysisData.totalCount || analysisData.stats.count;
    
    const aboveCount = getAboveThresholdCount(thresholdVal);
    const belowCount = totalCount - aboveCount;

    document.getElementById('aboveCount').textContent = aboveCount.toLocaleString();
    document.getElementById('belowCount').textContent = belowCount.toLocaleString();

    updateImageListStyles();
}

function drawDistributionChart(similarities) {
    const ctx = document.getElementById('distributionChart').getContext('2d');

    const bins = Array(10).fill(0);
    similarities.forEach(s => {
        const binIndex = Math.min(Math.floor(s.similarity / 10), 9);
        bins[binIndex]++;
    });

    const labels = ['0-10', '10-20', '20-30', '30-40', '40-50', '50-60', '60-70', '70-80', '80-90', '90-100'];

    if (distributionChart) {
        distributionChart.destroy();
    }

    distributionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '이미지 수',
                data: bins,
                backgroundColor: 'rgba(233, 69, 96, 0.6)',
                borderColor: 'rgba(233, 69, 96, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e1e3f',
                    titleColor: '#f8fafc',
                    bodyColor: '#94a3b8',
                    borderColor: '#2d2d3d',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    title: { display: true, text: '유사도 (%)', color: '#94a3b8' },
                    ticks: { color: '#64748b' },
                    grid: { color: '#2d2d3d' }
                },
                y: {
                    title: { display: true, text: '이미지 수', color: '#94a3b8' },
                    ticks: { color: '#64748b' },
                    grid: { color: '#2d2d3d' }
                }
            }
        }
    });
}

function renderImageList(similarities) {
    const container = document.getElementById('imageList');
    const thresholdVal = parseFloat(threshold.value);

    container.innerHTML = similarities.map(item => {
        const isAbove = item.similarity >= thresholdVal;
        const badgeClass = item.similarity >= 70 ? 'high' : item.similarity >= 40 ? 'medium' : 'low';

        return `
            <div class="image-item ${isAbove ? 'above-threshold' : 'below-threshold'}" data-similarity="${item.similarity}" data-name="${item.filename}">
                <div class="image-info">
                    <span class="image-name">${item.filename}</span>
                    <span class="image-path">${item.path}</span>
                </div>
                <span class="similarity-badge ${badgeClass}">${item.similarity}%</span>
            </div>
        `;
    }).join('');
}

function updateImageListStyles() {
    const thresholdVal = parseFloat(threshold.value);
    const items = document.querySelectorAll('#resultsSection .image-item');

    items.forEach(item => {
        const similarity = parseFloat(item.dataset.similarity);
        const isAbove = similarity >= thresholdVal;

        item.classList.toggle('above-threshold', isAbove);
        item.classList.toggle('below-threshold', !isAbove);
    });
}

function filterImageList() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const items = document.querySelectorAll('#resultsSection .image-item');

    items.forEach(item => {
        const name = item.dataset.name.toLowerCase();
        item.style.display = name.includes(searchTerm) ? '' : 'none';
    });
}

function sortImageList() {
    const sortBy = document.getElementById('sortSelect').value;
    const container = document.getElementById('imageList');
    const items = Array.from(container.querySelectorAll('.image-item'));

    items.sort((a, b) => {
        if (sortBy === 'desc') {
            return parseFloat(b.dataset.similarity) - parseFloat(a.dataset.similarity);
        } else if (sortBy === 'asc') {
            return parseFloat(a.dataset.similarity) - parseFloat(b.dataset.similarity);
        } else {
            return a.dataset.name.localeCompare(b.dataset.name);
        }
    });

    items.forEach(item => container.appendChild(item));
}

// ============================================
// Multi Mode Results Display
// ============================================

function displayMultiResults(data) {
    resultsSection.hidden = true;
    multiResultsSection.hidden = false;
    classifyResults.hidden = true;

    // Total stats
    document.getElementById('multiTotalCount').textContent = data.totalCount.toLocaleString();
    updateMultiThresholdDisplay();

    // Create tabs for each reference image
    const tabsContainer = document.getElementById('refTabs');
    const resultsContainer = document.getElementById('refResults');
    
    tabsContainer.innerHTML = '';
    resultsContainer.innerHTML = '';

    // Add "All" tab
    const allTab = document.createElement('button');
    allTab.className = 'ref-tab active';
    allTab.dataset.ref = 'all';
    allTab.textContent = '전체 (최고 유사도 기준)';
    allTab.addEventListener('click', () => switchRefTab('all'));
    tabsContainer.appendChild(allTab);

    // Add tabs for each reference with threshold info
    data.referenceImages.forEach((ref, idx) => {
        const refThreshold = refImages[idx] ? refImages[idx].threshold : 70;
        const tab = document.createElement('button');
        tab.className = 'ref-tab';
        tab.dataset.ref = ref.name;
        tab.innerHTML = `#${idx + 1} ${ref.name} <span class="tab-threshold">${refThreshold}%</span>`;
        tab.addEventListener('click', () => switchRefTab(ref.name));
        tabsContainer.appendChild(tab);
    });

    // Create "All" results panel
    createAllResultsPanel(data);

    // Create results panels for each reference
    data.referenceImages.forEach((ref, idx) => {
        createRefResultsPanel(ref, data.resultsByRef[ref.name], data.statsByRef[ref.name], idx);
    });

    multiResultsSection.scrollIntoView({ behavior: 'smooth' });
}

function drawMultiChart(canvasId, similarities, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Create histogram data
    const bins = Array(10).fill(0);
    similarities.forEach(sim => {
        const binIndex = Math.min(Math.floor(sim / 10), 9);
        bins[binIndex]++;
    });
    
    const labels = ['0-10', '10-20', '20-30', '30-40', '40-50', '50-60', '60-70', '70-80', '80-90', '90-100'];
    
    // Destroy existing chart if any
    if (multiCharts[canvasId]) {
        multiCharts[canvasId].destroy();
    }
    
    // Generate color based on label
    const hueOffset = canvasId === 'chartAll' ? 0 : parseInt(canvasId.replace('chartRef', '')) * 40;
    const hue = (270 + hueOffset) % 360;
    
    multiCharts[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `이미지 수 (${label})`,
                data: bins,
                backgroundColor: `hsla(${hue}, 70%, 55%, 0.6)`,
                borderColor: `hsla(${hue}, 70%, 55%, 1)`,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e1e3f',
                    titleColor: '#f8fafc',
                    bodyColor: '#94a3b8',
                    borderColor: '#2d2d3d',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    title: { display: true, text: '유사도 (%)', color: '#94a3b8' },
                    ticks: { color: '#64748b' },
                    grid: { color: '#2d2d3d' }
                },
                y: {
                    title: { display: true, text: '이미지 수', color: '#94a3b8' },
                    ticks: { color: '#64748b' },
                    grid: { color: '#2d2d3d' }
                }
            }
        }
    });
}

function createAllResultsPanel(data) {
    const panel = document.createElement('div');
    panel.className = 'ref-result-panel';
    panel.dataset.ref = 'all';
    
    panel.innerHTML = `
        <div class="ref-panel-stats">
            <p>각 이미지별 최고 유사도 기준으로 표시합니다. (각 기준 이미지별 임계치 적용)</p>
        </div>
        <div class="chart-container">
            <h3>전체 유사도 분포 (최고 유사도 기준)</h3>
            <canvas id="chartAll"></canvas>
        </div>
        <div class="image-list" id="allImageList">
            ${data.allResults.map(item => {
                const refIdx = data.referenceImages.findIndex(r => r.name === item.bestMatch.refName);
                const refThreshold = refImages[refIdx] ? refImages[refIdx].threshold : 70;
                const isAbove = item.bestMatch.similarity >= refThreshold;
                const badgeClass = item.bestMatch.similarity >= 70 ? 'high' : item.bestMatch.similarity >= 40 ? 'medium' : 'low';
                
                return `
                    <div class="image-item ${isAbove ? 'above-threshold' : 'below-threshold'}" 
                         data-similarity="${item.bestMatch.similarity}" 
                         data-name="${item.filename}"
                         data-ref="${item.bestMatch.refName}">
                        <div class="image-info">
                            <span class="image-name">${item.filename}</span>
                            <span class="image-path">${item.path}</span>
                            <span class="best-match-ref">→ ${item.bestMatch.refName} (임계치: ${refThreshold}%)</span>
                        </div>
                        <span class="similarity-badge ${badgeClass}">${item.bestMatch.similarity}%</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    
    document.getElementById('refResults').appendChild(panel);
    
    const similarities = data.allResults.map(item => item.bestMatch.similarity);
    drawMultiChart('chartAll', similarities, '전체');
}

function createRefResultsPanel(ref, results, stats, idx) {
    const panel = document.createElement('div');
    panel.className = 'ref-result-panel';
    panel.dataset.ref = ref.name;
    panel.hidden = true;
    
    const refThreshold = refImages[idx] ? refImages[idx].threshold : 70;
    const chartId = `chartRef${idx}`;
    
    panel.innerHTML = `
        <div class="ref-panel-header">
            <div class="ref-panel-info">
                <span class="ref-panel-name">#${idx + 1} ${ref.name}</span>
                <span class="ref-panel-folder">→ ${ref.targetFolder}</span>
                <span class="ref-panel-threshold" id="refThresholdDisplay${idx}">임계치: ${refThreshold}%</span>
            </div>
            <div class="ref-panel-stats-grid">
                <div class="mini-stat">
                    <span class="mini-stat-label">평균</span>
                    <span class="mini-stat-value">${stats.mean}%</span>
                </div>
                <div class="mini-stat">
                    <span class="mini-stat-label">최대</span>
                    <span class="mini-stat-value">${stats.max}%</span>
                </div>
                <div class="mini-stat">
                    <span class="mini-stat-label">최소</span>
                    <span class="mini-stat-value">${stats.min}%</span>
                </div>
                <div class="mini-stat highlight">
                    <span class="mini-stat-label">임계치 이상</span>
                    <span class="mini-stat-value" id="refAboveCount${idx}">${results.filter(r => r.similarity >= refThreshold).length}개</span>
                </div>
            </div>
        </div>
        <div class="chart-container">
            <h3>유사도 분포</h3>
            <canvas id="${chartId}"></canvas>
        </div>
        <div class="image-list" data-ref-idx="${idx}">
            ${results.map(item => {
                const isAbove = item.similarity >= refThreshold;
                const badgeClass = item.similarity >= 70 ? 'high' : item.similarity >= 40 ? 'medium' : 'low';
                
                return `
                    <div class="image-item ${isAbove ? 'above-threshold' : 'below-threshold'}" data-similarity="${item.similarity}" data-name="${item.filename}">
                        <div class="image-info">
                            <span class="image-name">${item.filename}</span>
                            <span class="image-path">${item.path}</span>
                        </div>
                        <span class="similarity-badge ${badgeClass}">${item.similarity}%</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    
    document.getElementById('refResults').appendChild(panel);
    
    const similarities = results.map(item => item.similarity);
    drawMultiChart(chartId, similarities, ref.name);
}

function switchRefTab(refName) {
    document.querySelectorAll('.ref-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.ref === refName);
    });
    
    document.querySelectorAll('.ref-result-panel').forEach(panel => {
        panel.hidden = panel.dataset.ref !== refName;
    });
}

function getMultiAboveThresholdCountIndividual() {
    if (!multiAnalysisData) return 0;
    
    let totalAbove = 0;
    
    // 전체 결과에서 각 기준 이미지의 임계치를 만족하는 개수 계산
    multiAnalysisData.allResults.forEach(item => {
        const refIdx = multiAnalysisData.referenceImages.findIndex(r => r.name === item.bestMatch.refName);
        const refThreshold = refImages[refIdx] ? refImages[refIdx].threshold : 70;
        if (item.bestMatch.similarity >= refThreshold) {
            totalAbove++;
        }
    });
    
    return totalAbove;
}

function updateMultiThresholdDisplay() {
    if (!multiAnalysisData) return;
    
    const aboveCount = getMultiAboveThresholdCountIndividual();
    document.getElementById('multiAboveCount').textContent = aboveCount.toLocaleString();
    
    multiAnalysisData.referenceImages.forEach((ref, idx) => {
        const refThreshold = refImages[idx] ? refImages[idx].threshold : 70;
        
        const thresholdDisplay = document.getElementById(`refThresholdDisplay${idx}`);
        if (thresholdDisplay) {
            thresholdDisplay.textContent = `임계치: ${refThreshold}%`;
        }
        
        const aboveCountEl = document.getElementById(`refAboveCount${idx}`);
        if (aboveCountEl && multiAnalysisData.thresholdCountsByRef[ref.name]) {
            // thresholdCountsByRef는 전체 데이터를 기반으로 계산되었으므로 정확함
            const count = multiAnalysisData.thresholdCountsByRef[ref.name][Math.round(refThreshold)] || 0;
            aboveCountEl.textContent = `${count.toLocaleString()}개`;
        }
        
        const tab = document.querySelector(`.ref-tab[data-ref="${ref.name}"] .tab-threshold`);
        if (tab) {
            tab.textContent = `${refThreshold}%`;
        }
    });
    
    // Update image list styles
    document.querySelectorAll('#allImageList .image-item').forEach(item => {
        const similarity = parseFloat(item.dataset.similarity);
        const refName = item.dataset.ref;
        const refIdx = multiAnalysisData.referenceImages.findIndex(r => r.name === refName);
        const refThreshold = refImages[refIdx] ? refImages[refIdx].threshold : 70;
        const isAbove = similarity >= refThreshold;
        
        item.classList.toggle('above-threshold', isAbove);
        item.classList.toggle('below-threshold', !isAbove);
        
        const thresholdInfo = item.querySelector('.best-match-ref');
        if (thresholdInfo) {
            thresholdInfo.textContent = `→ ${refName} (임계치: ${refThreshold}%)`;
        }
    });
    
    document.querySelectorAll('.ref-result-panel[data-ref]:not([data-ref="all"]) .image-list').forEach(list => {
        const refIdx = parseInt(list.dataset.refIdx) || 0;
        const refThreshold = refImages[refIdx] ? refImages[refIdx].threshold : 70;
        
        list.querySelectorAll('.image-item').forEach(item => {
            const similarity = parseFloat(item.dataset.similarity);
            const isAbove = similarity >= refThreshold;
            
            item.classList.toggle('above-threshold', isAbove);
            item.classList.toggle('below-threshold', !isAbove);
        });
    });
}

// ============================================
// Classification Results Display
// ============================================

function displayClassifyResults(data, action) {
    classifyResults.hidden = false;

    document.getElementById('movedCount').textContent = data.moved.length.toLocaleString();
    document.getElementById('errorCount').textContent = data.errors.length.toLocaleString();

    const movedList = document.getElementById('movedFilesList');

    if (data.moved.length === 0) {
        movedList.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">${action}된 파일이 없습니다.</p>`;
    } else {
        const displayItems = data.moved.slice(0, 100);
        movedList.innerHTML = displayItems.map(item => `
            <div class="moved-file-item">
                <div class="move-icon">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
                <div class="move-details">
                    <div class="move-source">${item.source}</div>
                    <div class="move-arrow">↓</div>
                    <div class="move-dest">${item.destination}</div>
                </div>
                <div class="move-similarity">${item.similarity}%</div>
            </div>
        `).join('');

        if (data.moved.length > 100) {
            movedList.innerHTML += `<p style="color: var(--text-muted); text-align: center; padding: 1rem;">... 외 ${data.moved.length - 100}개 더</p>`;
        }
    }

    classifyResults.scrollIntoView({ behavior: 'smooth' });
}

function displayMultiClassifyResults(data, action) {
    classifyResults.hidden = false;

    document.getElementById('movedCount').textContent = data.moved.length.toLocaleString();
    document.getElementById('errorCount').textContent = data.errors.length.toLocaleString();

    const movedList = document.getElementById('movedFilesList');

    if (data.moved.length === 0) {
        movedList.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">${action}된 파일이 없습니다.</p>`;
    } else {
        const byRef = {};
        data.moved.forEach(item => {
            const refName = item.refName || '기타';
            if (!byRef[refName]) byRef[refName] = [];
            byRef[refName].push(item);
        });

        let html = '';
        for (const [refName, items] of Object.entries(byRef)) {
            html += `<div class="moved-ref-group">
                <h4 class="moved-ref-title">${refName} <span>(${items.length}개)</span></h4>
                ${items.slice(0, 50).map(item => `
                    <div class="moved-file-item">
                        <div class="move-icon">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                        <div class="move-details">
                            <div class="move-source">${item.source}</div>
                            <div class="move-arrow">↓</div>
                            <div class="move-dest">${item.destination}</div>
                        </div>
                        <div class="move-similarity">${item.similarity}%</div>
                    </div>
                `).join('')}
                ${items.length > 50 ? `<p style="color: var(--text-muted); text-align: center; padding: 0.5rem;">... 외 ${items.length - 50}개 더</p>` : ''}
            </div>`;
        }
        movedList.innerHTML = html;
    }

    classifyResults.scrollIntoView({ behavior: 'smooth' });
}

// ============================================
// Utility Functions
// ============================================

function clearResults() {
    analysisData = null;
    multiAnalysisData = null;
    resultId = null;
    if (resultsSection) resultsSection.hidden = true;
    if (multiResultsSection) multiResultsSection.hidden = true;
    if (classifyResults) classifyResults.hidden = true;
    if (classifyBtn) classifyBtn.disabled = true;
    
    if (distributionChart) {
        distributionChart.destroy();
        distributionChart = null;
    }
    
    for (const chartId in multiCharts) {
        if (multiCharts[chartId]) {
            multiCharts[chartId].destroy();
        }
    }
    multiCharts = {};
}

// ============================================
// 폴더 브라우저
// ============================================

let folderBrowserTarget = null;
let currentBrowserPath = '/host/mnt/d';
let selectedFolderPath = null;

function setupFolderBrowser() {
    // 찾기 버튼들 이벤트
    document.querySelectorAll('.btn-browse').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            openFolderBrowser(targetId);
        });
    });

    // 모달 닫기
    const closeBrowserBtn = document.getElementById('closeFolderBrowser');
    const cancelBtn = document.getElementById('cancelFolderSelect');
    if (closeBrowserBtn) closeBrowserBtn.addEventListener('click', closeFolderBrowser);
    if (cancelBtn) cancelBtn.addEventListener('click', closeFolderBrowser);

    // 폴더 선택 확인
    const confirmBtn = document.getElementById('confirmFolderSelect');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmFolderSelection);

    // 상위 폴더 버튼
    const pathUpBtn = document.getElementById('pathUpBtn');
    if (pathUpBtn) pathUpBtn.addEventListener('click', goToParentFolder);

    // 모달 바깥 클릭 시 닫기
    const modal = document.getElementById('folderBrowserModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeFolderBrowser();
        });
    }
}

function openFolderBrowser(targetId) {
    folderBrowserTarget = targetId;
    selectedFolderPath = null;
    currentBrowserPath = '/host/mnt/d';
    
    const modal = document.getElementById('folderBrowserModal');
    if (modal) modal.hidden = false;
    
    loadFolderContents(currentBrowserPath);
}

function closeFolderBrowser() {
    const modal = document.getElementById('folderBrowserModal');
    if (modal) modal.hidden = true;
    folderBrowserTarget = null;
    selectedFolderPath = null;
}

async function loadFolderContents(path) {
    const folderList = document.getElementById('folderList');
    const pathInput = document.getElementById('currentPathInput');
    
    if (!folderList) return;
    
    folderList.innerHTML = '';
    folderList.classList.add('loading');
    
    try {
        const response = await fetch('/batch/browse-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path })
        });
        
        const data = await response.json();
        
        folderList.classList.remove('loading');
        
        if (data.error) {
            folderList.innerHTML = `<div class="folder-browser-empty">❌ ${data.error}</div>`;
            return;
        }
        
        currentBrowserPath = data.currentPath;
        if (pathInput) pathInput.value = currentBrowserPath;
        
        if (!data.items || data.items.length === 0) {
            folderList.innerHTML = '<div class="folder-browser-empty">📭 폴더가 비어있습니다</div>';
            return;
        }
        
        data.items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'folder-item';
            div.dataset.path = item.path;
            
            const iconSpan = document.createElement('span');
            iconSpan.className = 'folder-icon';
            iconSpan.textContent = '📁';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'folder-name';
            nameSpan.textContent = item.name;
            
            div.appendChild(iconSpan);
            div.appendChild(nameSpan);
            
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                // 선택 토글
                document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
                selectedFolderPath = item.path;
            });
            
            div.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                // 더블클릭: 폴더 진입
                loadFolderContents(item.path);
            });
            
            folderList.appendChild(div);
        });
        
    } catch (error) {
        folderList.classList.remove('loading');
        folderList.innerHTML = `<div class="folder-browser-empty">❌ 오류: ${error.message}</div>`;
    }
}

function goToParentFolder() {
    if (currentBrowserPath === '/' || currentBrowserPath === '/host') {
        return;
    }
    const parentPath = currentBrowserPath.split('/').slice(0, -1).join('/') || '/';
    loadFolderContents(parentPath);
}

function confirmFolderSelection() {
    const pathToUse = selectedFolderPath || currentBrowserPath;
    
    if (!pathToUse) {
        alert('폴더를 선택해주세요.');
        return;
    }
    
    if (folderBrowserTarget) {
        const targetInput = document.getElementById(folderBrowserTarget);
        if (targetInput) {
            targetInput.value = pathToUse;
            targetInput.dispatchEvent(new Event('input'));
        }
    }
    
    closeFolderBrowser();
    updateButtonStates();
}

// ref 카드 폴더 브라우저 연결
function setupRefCardBrowseButton(card, index) {
    const browseBtn = card.querySelector('.btn-browse-small');
    const folderInput = card.querySelector('.ref-folder');
    
    if (browseBtn && folderInput) {
        browseBtn.addEventListener('click', () => {
            openRefFolderBrowser(index, folderInput);
        });
    }
}

let refFolderBrowserCallback = null;

function openRefFolderBrowser(index, inputElement) {
    selectedFolderPath = null;
    currentBrowserPath = '/host/mnt/d';
    
    refFolderBrowserCallback = (path) => {
        inputElement.value = path;
        refImages[index].folder = path;
        updateButtonStates();
    };
    
    const modal = document.getElementById('folderBrowserModal');
    if (modal) modal.hidden = false;
    
    // 임시로 folderBrowserTarget을 null로 설정하고 콜백 사용
    folderBrowserTarget = null;
    
    loadFolderContents(currentBrowserPath);
}

// confirmFolderSelection 함수 수정
const originalConfirmFolderSelection = confirmFolderSelection;
confirmFolderSelection = function() {
    const pathToUse = selectedFolderPath || currentBrowserPath;
    
    if (!pathToUse) {
        alert('폴더를 선택해주세요.');
        return;
    }
    
    if (refFolderBrowserCallback) {
        refFolderBrowserCallback(pathToUse);
        refFolderBrowserCallback = null;
        closeFolderBrowser();
        return;
    }
    
    if (folderBrowserTarget) {
        const targetInput = document.getElementById(folderBrowserTarget);
        if (targetInput) {
            targetInput.value = pathToUse;
            targetInput.dispatchEvent(new Event('input'));
        }
    }
    
    closeFolderBrowser();
    updateButtonStates();
};

// 초기화 시 폴더 브라우저 설정
document.addEventListener('DOMContentLoaded', () => {
    setupFolderBrowser();
});

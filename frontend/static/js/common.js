/* ============================================
   Common JavaScript - 공통 유틸리티
   ============================================ */

// Loading Overlay
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');

function showLoading(text = '처리 중...') {
    if (loadingText) loadingText.textContent = text;
    if (loadingOverlay) loadingOverlay.hidden = false;
}

function hideLoading() {
    if (loadingOverlay) loadingOverlay.hidden = true;
}

// Drag & Drop Setup
function setupDragDrop(element, dropHandler) {
    if (!element) return;
    
    element.addEventListener('dragover', (e) => {
        e.preventDefault();
        element.classList.add('drag-over');
    });

    element.addEventListener('dragleave', () => {
        element.classList.remove('drag-over');
    });

    element.addEventListener('drop', (e) => {
        e.preventDefault();
        element.classList.remove('drag-over');
        dropHandler(e);
    });
}

// Read File as Data URL
function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Format number with locale
function formatNumber(num) {
    return num.toLocaleString();
}

// Export for use in other modules
window.CommonUtils = {
    showLoading,
    hideLoading,
    setupDragDrop,
    readFileAsDataURL,
    formatNumber
};

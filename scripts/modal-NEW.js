document.addEventListener('DOMContentLoaded', function() {
// Modal & gallery logic tailored for test.html

let currentImages = [];
let currentIndex = 0;
let thumbsSwiper = null;
let pswp = null;

// Build hidden gallery (PhotoSwipe expects <figure><a data-size="w x h"></a></figure>)
function buildHiddenGallery(images) {
  const hidden = document.querySelector('.hiddenGallery');
  if (!hidden) return;
  const defaultSize = '1200x1600';
  hidden.innerHTML = images
    .map((src) => {
      const clean = src.trim();
      const size = defaultSize;
      return `<figure><a href="${clean}" data-size="${size}"><img src="${clean}" alt=""></a></figure>`;
    })
    .join('');
}

// Update main image, clone and thumbs state
function setImage(idx) {
  if (!currentImages.length) return;
  currentIndex = (idx + currentImages.length) % currentImages.length;

  const mainImg = document.getElementById('modalImage');
  const cloneImg = document.querySelector('.clone');
  const src = currentImages[currentIndex].trim();

  if (mainImg) {
    mainImg.src = src;
    mainImg.dataset.large = src;
  }
  if (cloneImg) cloneImg.src = src;

  const slides = document.querySelectorAll('#thumbsVertical .swiper-slide');
  slides.forEach((s, i) => {
    if (i === currentIndex) s.classList.add('active');
    else s.classList.remove('active');
  });

  if (thumbsSwiper) {
    thumbsSwiper.slideTo(currentIndex);
  }

  if (pswp) {
    pswp.goTo(currentIndex);
  }
}

function populateThumbs(images) {
  const wrapper = document.querySelector('#thumbsVertical .swiper-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = '';
  images.forEach((src, i) => {
    wrapper.insertAdjacentHTML(
      'beforeend',
      `<div class="swiper-slide itmSImg ${i === 0 ? 'active' : ''}" data-index="${i}">
        <a href="javascript:void(0)"><img class="thumb" src="${src.trim()}" alt="Photo ${i + 1}"></a>
      </div>`
    );
  });
}

function openModal(card) {
  const modal = document.getElementById('productModal');
  if (!modal) return;

  const nameEl = document.getElementById('modalName');
  const priceEl = document.getElementById('modalPrice');
  const descEl = document.getElementById('modalDescription');
  const articleEl = document.getElementById('modalArticle');
  const statusEl = document.getElementById('modalStatus');

  if (nameEl) nameEl.textContent = card.dataset.name || '';
  if (priceEl) priceEl.textContent = card.dataset.price || '';
  if (descEl) descEl.innerHTML = (card.dataset.description || '').replace(/\r?\n|&#10;/g, '<br>');
  if (articleEl) articleEl.textContent = card.dataset.article ? `Артикул: ${card.dataset.article}` : '';
  if (statusEl) statusEl.textContent = card.dataset.status || 'Товар в наявності';

  currentImages = (card.dataset.images || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!currentImages.length) {
    currentImages = ['/assets/images/placeholder.webp'];
  }

  currentIndex = 0;
  buildHiddenGallery(currentImages);
  populateThumbs(currentImages);
  setImage(0);

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    initSwiper();
    initPhotoSwipe();
  }, 0);
}

function initSwiper() {
  if (!window.Swiper) return;

  try {
    if (thumbsSwiper) {
      thumbsSwiper.destroy(true, true);
      thumbsSwiper = null;
    }

    const vertical = window.innerWidth > 1000;
    thumbsSwiper = new Swiper('#thumbsVertical', {
      direction: vertical ? 'vertical' : 'horizontal',
      slidesPerView: vertical ? 4 : 3,
      spaceBetween: vertical ? 48 : 12,
      navigation: {
        nextEl: '.vertNavigation .next',
        prevEl: '.vertNavigation .prev'
      },
      breakpoints: {
        250: { direction: 'horizontal', spaceBetween: 0, slidesPerView: 1 },
        330: { direction: 'horizontal', spaceBetween: 30, slidesPerView: 2 },
        480: { direction: 'horizontal', spaceBetween: 30, slidesPerView: 3 },
        730: { direction: 'horizontal', spaceBetween: 30, slidesPerView: 4 },
        850: { direction: 'horizontal', spaceBetween: 30, slidesPerView: 3 },
        1000:{ direction: 'horizontal', spaceBetween: 30, slidesPerView: 4 },
        1200:{ direction: 'vertical',   spaceBetween: 48, slidesPerView: 4 }
      }
    });

    thumbsSwiper.on('click', function() {
      if (typeof this.clickedIndex === 'number') {
        setImage(this.clickedIndex);
      }
    });
  } catch (err) {
    console.warn('Swiper init error', err);
  }
}

function initPhotoSwipe() {
  if (!window.PhotoSwipe || !window.PhotoSwipeUI_Default) return;

  const pswpEl = document.querySelector('.pswp');
  if (!pswpEl || !currentImages.length) return;

  const items = currentImages.map((src) => ({
    src: src.trim(),
    w: 1200,
    h: 1600,
    title: ''
  }));

  if (pswp) {
    pswp.close();
    pswp = null;
  }

  pswp = new PhotoSwipe(pswpEl, PhotoSwipeUI_Default, items, {
    index: currentIndex,
    history: false,
    focus: false,
    showAnimationDuration: 0,
    hideAnimationDuration: 0
  });

  pswp.init();

  const mainImg = document.getElementById('modalImage');
  if (mainImg) {
    mainImg.style.cursor = 'pointer';
    mainImg.onclick = function() {
      if (!pswp) {
        initPhotoSwipe();
        return;
      }
      pswp.goTo(currentIndex);
    };
  }
}

function closeModal() {
  const modal = document.getElementById('productModal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = 'auto';

  if (thumbsSwiper) {
    thumbsSwiper.destroy(true, true);
    thumbsSwiper = null;
  }

  if (pswp) {
    pswp.close();
    pswp = null;
  }
}

function nextImage() {
  setImage(currentIndex + 1);
}

function prevImage() {
  setImage(currentIndex - 1);
}

document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('productModal');

  // Close on outside click
  window.addEventListener('click', function(e) {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft') prevImage();
    if (e.key === 'ArrowRight') nextImage();
  });

  // Touch swipe on gallery area
  const galleryArea = document.querySelector('.matImages');
  if (galleryArea) {
    let sx = null;
    let sy = null;
    galleryArea.addEventListener('touchstart', function(e) {
      if (e.touches.length === 1) {
        sx = e.touches[0].screenX;
        sy = e.touches[0].screenY;
      }
    });
    galleryArea.addEventListener('touchend', function(e) {
      if (sx === null) return;
      const dx = e.changedTouches[0].screenX - sx;
      const dy = e.changedTouches[0].screenY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 60) {
        if (dx > 0) prevImage();
        else nextImage();
      }
      sx = null;
      sy = null;
    });
  }

  // Bind inline handlers to global scope
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.nextImage = nextImage;
  window.prevImage = prevImage;
  window.setImage = setImage;
});

});
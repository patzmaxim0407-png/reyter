const modal = document.getElementById('productModal');

let currentImages = [];
let currentIndex = 0;
let modalThumbsSwiper = null;

function setImage(idx) {
  if (!currentImages.length) return;
  currentIndex = (idx + currentImages.length) % currentImages.length;
  const modalImage = document.getElementById('modalImage');
  const cloneImage = document.querySelector('.clone');
  
  modalImage.src = currentImages[currentIndex].trim();
  if (cloneImage) cloneImage.src = currentImages[currentIndex].trim();
  
  // Update active thumbnail
  const slides = document.querySelectorAll('#thumbsVertical .swiper-slide');
  slides.forEach(s => s.classList.remove('active'));
  if (slides[currentIndex]) slides[currentIndex].classList.add('active');
  
  // Scroll thumbnail into view if needed
  if (modalThumbsSwiper) {
    modalThumbsSwiper.slideTo(currentIndex);
  }
}

function openModal(card) {
  const modalName = document.getElementById('modalName');
  const modalPrice = document.getElementById('modalPrice');
  const modalDescription = document.getElementById('modalDescription');
  
  // Populate basic product info
  modalName.textContent = card.dataset.name;
  modalPrice.textContent = card.dataset.price;
  modalDescription.innerHTML = card.dataset.description.replace(/\n|\r|\r\n|&#10;/g, '<br>');
  
  // Extract and prepare images
  currentImages = card.dataset.images.split(',').map(s => s.trim()).filter(Boolean);
  if (currentImages.length === 0) {
    currentImages = ['assets/images/boxers/sr1.webp'];
  }
  currentIndex = 0;
  
  // Set first image
  setImage(0);
  
  // Populate article/status
  const articleEl = document.getElementById('modalArticle');
  if (articleEl && card.dataset.article) {
    articleEl.textContent = card.dataset.article;
  }
  
  // Populate sizes
  const sizesContainer = document.getElementById('modalSizes');
  if (sizesContainer) {
    const sizes = ['S', 'M', 'L', 'XL'];
    sizesContainer.innerHTML = sizes.map((size) => 
      `<label class="size-radio"><input type="radio" name="modal-size" value="${size}"> ${size}</label>`
    ).join('');
  }
  
  // Populate characteristics
  const charList = card.dataset.characteristics;
  if (charList) {
    const charArray = charList.split('|').map(s => s.trim());
    const charContainer = document.getElementById('characteristicsList');
    document.getElementById('modalCharacteristics').style.display = 'block';
    if (charContainer) charContainer.innerHTML = charArray.map(c => `<li>${c}</li>`).join('');
  } else {
    document.getElementById('modalCharacteristics').style.display = 'none';
  }
  
  // Populate material
  const material = card.dataset.material;
  if (material) {
    const matArray = material.split('|').map(s => s.trim());
    const matContainer = document.getElementById('materialList');
    document.getElementById('modalMaterial').style.display = 'block';
    if (matContainer) matContainer.innerHTML = matArray.map(m => `<li>${m}</li>`).join('');
  } else {
    document.getElementById('modalMaterial').style.display = 'none';
  }
  
  // Populate care
  const care = card.dataset.care;
  if (care) {
    const careArray = care.split('|').map(s => s.trim());
    const careContainer = document.getElementById('careList');
    document.getElementById('modalCare').style.display = 'block';
    if (careContainer) careContainer.innerHTML = careArray.map(c => `<li>${c}</li>`).join('');
  } else {
    document.getElementById('modalCare').style.display = 'none';
  }
  
  // Populate hiddenGallery for PhotoSwipe
  const hiddenGalleryEl = document.querySelector('.hiddenGallery');
  if (hiddenGalleryEl) {
    hiddenGalleryEl.innerHTML = '';
    currentImages.forEach((src) => {
      hiddenGalleryEl.insertAdjacentHTML('beforeend', 
        `<figure><a href="${src}" data-size=""><img src="${src}" alt=""></a></figure>`
      );
    });
  }
  
  // Populate thumbnails
  const thumbsWrapper = document.querySelector('#thumbsVertical .swiper-wrapper');
  if (thumbsWrapper) {
    thumbsWrapper.innerHTML = '';
    currentImages.forEach((src, i) => {
      thumbsWrapper.insertAdjacentHTML('beforeend', 
        `<div class="swiper-slide itmSImg ${i === 0 ? 'active' : ''}" data-index="${i}">
          <a href="${src}"><img class="thumb" src="${src}" alt="Фото ${i + 1}" onclick="setImage(${i})"></a>
        </div>`
      );
    });
  }
  
  // Show modal
  modal.classList.remove('hidden');
  
  // Initialize or update Swiper
  setTimeout(() => {
    initSwiper();
  }, 0);
}

function initSwiper() {
  if (!window.Swiper) return;
  
  try {
    // Destroy existing Swiper instance if it exists
    if (modalThumbsSwiper) {
      modalThumbsSwiper.destroy();
      modalThumbsSwiper = null;
    }
    
    // Create new Swiper instance
    modalThumbsSwiper = new Swiper('#thumbsVertical', {
      direction: 'vertical',
      slidesPerView: 4,
      spaceBetween: 12,
      navigation: {
        nextEl: '.vertNavigation .next',
        prevEl: '.vertNavigation .prev',
      },
      breakpoints: {
        320: {
          direction: 'horizontal',
          slidesPerView: 2,
          spaceBetween: 8,
        },
        480: {
          direction: 'horizontal',
          slidesPerView: 3,
          spaceBetween: 12,
        },
        768: {
          direction: 'horizontal',
          slidesPerView: 4,
          spaceBetween: 12,
        },
        1024: {
          direction: 'vertical',
          slidesPerView: 4,
          spaceBetween: 12,
        }
      }
    });
  } catch (e) {
    console.warn('Swiper init failed:', e);
  }
}

function closeModal() {
  modal.classList.add('hidden');
  if (modalThumbsSwiper) {
    modalThumbsSwiper.destroy();
    modalThumbsSwiper = null;
  }
}

function nextImage() {
  setImage(currentIndex + 1);
}

function prevImage() {
  setImage(currentIndex - 1);
}

// Close modal by clicking outside
window.addEventListener('click', function (e) {
  if (e.target === modal) {
    closeModal();
  }
});

// Close modal by ESC key, navigate with arrow keys
document.addEventListener('keydown', function (e) {
  if (modal.classList.contains('hidden')) return;
  
  if (e.key === 'Escape') {
    closeModal();
  } else if (e.key === 'ArrowLeft') {
    prevImage();
  } else if (e.key === 'ArrowRight') {
    nextImage();
  }
});

// Touch swipe support for mobile
(function enableSwipe() {
  const galleryArea = document.querySelector('.matImages');
  if (!galleryArea) return;
  
  let touchStartX = null;
  let touchStartY = null;
  
  galleryArea.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].screenX;
      touchStartY = e.touches[0].screenY;
    }
  });
  
  galleryArea.addEventListener('touchend', function(e) {
    if (touchStartX === null) return;
    
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;
    
    // Swipe right = previous, Swipe left = next
    if (Math.abs(diffX) > 50 && Math.abs(diffY) < 60) {
      if (diffX > 0) {
        prevImage();
      } else {
        nextImage();
      }
    }
    
    touchStartX = null;
    touchStartY = null;
  });
})();
let currentImages = [];
let currentIndex = 0;
let modalThumbsSwiper = null;
let photoswipeInstance = null;

// Utility: Set current image (main gallery + Swiper sync)
function setImage(idx) {
  if (!currentImages.length) return;
  currentIndex = (idx + currentImages.length) % currentImages.length;
  const modalImage = document.getElementById('modalImage');
  const cloneImage = document.querySelector('.clone');
  
  modalImage.src = currentImages[currentIndex].trim();
  if (cloneImage) cloneImage.src = currentImages[currentIndex].trim();
  
  // Update active thumbnail class
  const slides = document.querySelectorAll('#thumbsVertical .swiper-slide');
  slides.forEach(s => s.classList.remove('active'));
  if (slides[currentIndex]) slides[currentIndex].classList.add('active');
  
  // Scroll thumbnail carousel to active slide
  if (modalThumbsSwiper) {
    modalThumbsSwiper.slideTo(currentIndex);
  }
  
  // Update PhotoSwipe index
  if (photoswipeInstance) {
    photoswipeInstance.goTo(currentIndex);
  }
}

// Open modal with product card data
function openModal(card) {
  const modalName = document.getElementById('modalName');
  const modalPrice = document.getElementById('modalPrice');
  const modalDescription = document.getElementById('modalDescription');
  
  // Populate basic product info
  modalName.textContent = card.dataset.name || '';
  modalPrice.textContent = card.dataset.price || '';
  
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
    articleEl.textContent = 'Артикул: ' + card.dataset.article;
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
  
  // Populate description
  if (modalDescription && card.dataset.description) {
    modalDescription.innerHTML = card.dataset.description.replace(/\n|\r|\r\n|&#10;/g, '<br>');
  }
  
  // Populate thumbnails in Swiper
  const thumbsWrapper = document.querySelector('#thumbsVertical .swiper-wrapper');
  if (thumbsWrapper) {
    thumbsWrapper.innerHTML = '';
    currentImages.forEach((src, i) => {
      thumbsWrapper.insertAdjacentHTML('beforeend', 
        `<div class="swiper-slide itmSImg ${i === 0 ? 'active' : ''}" data-index="${i}">
          <a href="javascript:void(0)" onclick="setImage(${i}); return false;"><img class="thumb" src="${src}" alt="Photo ${i + 1}"></a>
        </div>`
      );
    });
  }
  
  // Show modal
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  
  // Initialize Swiper thumbnail carousel
  setTimeout(() => {
    initSwiper();
    initPhotoSwipe();
  }, 0);
}

// Initialize Swiper v4.5.0 thumbnail carousel
function initSwiper() {
  if (!window.Swiper) return;
  
  try {
    // Destroy existing Swiper instance
    if (modalThumbsSwiper) {
      modalThumbsSwiper.destroy();
      modalThumbsSwiper = null;
    }
    
    // Create new Swiper v4.5.0 instance
    const thumbsContainer = document.querySelector('#thumbsVertical');
    if (!thumbsContainer) return;
    
    const isVertical = window.innerWidth > 1024;
    
    modalThumbsSwiper = new Swiper('#thumbsVertical', {
      direction: isVertical ? 'vertical' : 'horizontal',
      slidesPerView: isVertical ? 4 : 3,
      spaceBetween: isVertical ? 8 : 6,
      freeMode: false,
      roundLengths: true,
      keyboard: {
        enabled: true,
        onlyInViewport: false
      },
      breakpoints: {
        320: {
          direction: 'horizontal',
          slidesPerView: 3,
          spaceBetween: 6
        },
        480: {
          direction: 'horizontal',
          slidesPerView: 4,
          spaceBetween: 6
        },
        768: {
          direction: 'horizontal',
          slidesPerView: 4,
          spaceBetween: 8
        },
        1025: {
          direction: 'vertical',
          slidesPerView: 4,
          spaceBetween: 8
        }
      }
    });
    
    // Sync click on thumbnail with setImage
    modalThumbsSwiper.on('click', function() {
      if (this.clickedIndex !== undefined) {
        setImage(this.clickedIndex);
      }
    });
    
  } catch (e) {
    console.warn('Swiper v4.5.0 init failed:', e);
  }
}

// Initialize PhotoSwipe v4.1.3 lightbox
function initPhotoSwipe() {
  if (!window.PhotoSwipe || !window.PhotoSwipeUI_Default) return;
  
  try {
    // Prepare gallery items for PhotoSwipe
    const items = currentImages.map(img => ({
      src: img.trim(),
      w: 800,
      h: 800,
      title: ''
    }));
    
    const pswpElement = document.querySelector('.pswp');
    if (!pswpElement || items.length === 0) return;
    
    const options = {
      index: currentIndex,
      shareButtons: [
        { id: 'facebook', label: 'Share on Facebook', url: 'https://www.facebook.com/sharer/sharer.php?u={{url}}' },
        { id: 'twitter', label: 'Tweet', url: 'https://twitter.com/intent/tweet?text={{text}}&url={{url}}' },
        { id: 'pinterest', label: 'Pin it', url: 'http://www.pinterest.com/pin/create/button/?url={{url}}&media={{image_url}}&description={{text}}' }
      ],
      captionEl: true,
      fullscreenEl: true,
      shareEl: true,
      counterEl: true
    };
    
    // Initialize PhotoSwipe instance
    photoswipeInstance = new PhotoSwipe(pswpElement, PhotoSwipeUI_Default, items, options);
    
    // Add click handler to main image for fullscreen view
    const mainImage = document.getElementById('modalImage');
    if (mainImage) {
      mainImage.style.cursor = 'pointer';
      mainImage.onclick = function() {
        if (photoswipeInstance) {
          photoswipeInstance.updateItems(items);
          photoswipeInstance.goTo(currentIndex);
          photoswipeInstance.init();
        }
      };
    }
    
  } catch (e) {
    console.warn('PhotoSwipe v4.1.3 init failed:', e);
  }
}

// Close modal and cleanup
function closeModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = 'auto';
  
  // Destroy Swiper instance
  if (modalThumbsSwiper) {
    modalThumbsSwiper.destroy();
    modalThumbsSwiper = null;
  }
  
  // Close PhotoSwipe if open
  if (photoswipeInstance) {
    photoswipeInstance.close();
    photoswipeInstance = null;
  }
}

// Navigation functions
function nextImage() {
  setImage(currentIndex + 1);
}

function prevImage() {
  setImage(currentIndex - 1);
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
  // Close modal on outside click
  window.addEventListener('click', function (e) {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close modal on ESC key, navigate with arrow keys
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
  const galleryArea = document.querySelector('.matImages');
  if (galleryArea) {
    let touchStartX = null;
    let touchStartY = null;
    
    galleryArea.addEventListener('touchstart', function(e) {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].screenX;
        touchStartY = e.touches[0].screenY;
      }
    }, false);
    
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
    }, false);
  }
});
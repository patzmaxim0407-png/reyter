
  const modal = document.getElementById('productModal');
  const modalName = document.getElementById('modalName');
  const modalPrice = document.getElementById('modalPrice');
  const modalDescription = document.getElementById('modalDescription');
  const modalImage = document.getElementById('modalImage');
  const modalGallery = document.querySelector('.modal-gallery');

  let currentImages = [];
  let currentIndex = 0;

  function showImage(idx) {
    if (!currentImages.length) return;
    currentIndex = (idx + currentImages.length) % currentImages.length;
    modalImage.src = currentImages[currentIndex].trim();
    // update active thumbnail
    const slides = document.querySelectorAll('#thumbsVertical .swiper-slide');
    slides.forEach(s => s.classList.remove('active'));
    if (slides[currentIndex]) slides[currentIndex].classList.add('active');
  }

  function openModal(card) {
    modalName.textContent = card.dataset.name;
    modalPrice.textContent = card.dataset.price;
    modalDescription.innerHTML = card.dataset.description.replace(/\n|\r|\r\n|&#10;/g, '<br>');
    currentImages = card.dataset.images.split(',').map(s => s.trim()).filter(Boolean);
    showImage(0);
    modal.classList.remove('hidden');
    
    // Populate article
    const articleEl = document.getElementById('modalArticle');
    if (articleEl && card.dataset.article) {
      articleEl.textContent = card.dataset.article;
    }
    
    // Populate sizes
    const sizesContainer = document.getElementById('modalSizes');
    if (sizesContainer) {
      const sizes = ['S', 'M', 'L'];
      sizesContainer.innerHTML = sizes.map((size, idx) => 
        `<label class="size-radio"><input type="radio" name="modal-size" value="${size}" data-index="${idx}"> ${size}</label>`
      ).join('');
    }
    
    // Populate characteristics if provided
    const charList = card.dataset.characteristics;
    if (charList) {
      const charArray = charList.split('|');
      const charContainer = document.getElementById('characteristicsList');
      document.getElementById('modalCharacteristics').style.display = 'block';
      if (charContainer) charContainer.innerHTML = charArray.map(c => `<li>${c}</li>`).join('');
    } else {
      document.getElementById('modalCharacteristics').style.display = 'none';
    }
    
    // Populate material if provided
    const material = card.dataset.material;
    if (material) {
      const matArray = material.split('|');
      const matContainer = document.getElementById('materialList');
      document.getElementById('modalMaterial').style.display = 'block';
      if (matContainer) matContainer.innerHTML = matArray.map(m => `<li>${m}</li>`).join('');
    } else {
      document.getElementById('modalMaterial').style.display = 'none';
    }
    
    // Populate care if provided
    const care = card.dataset.care;
    if (care) {
      const careArray = care.split('|');
      const careContainer = document.getElementById('careList');
      document.getElementById('modalCare').style.display = 'block';
      if (careContainer) careContainer.innerHTML = careArray.map(c => `<li>${c}</li>`).join('');
    } else {
      document.getElementById('modalCare').style.display = 'none';
    }
    // populate hiddenGallery and thumbnails
    const hiddenGalleryEl = document.querySelector('.hiddenGallery');
    const thumbsWrapper = document.querySelector('#thumbsVertical .swiper-wrapper');
    if (hiddenGalleryEl) hiddenGalleryEl.innerHTML = '';
    if (thumbsWrapper) thumbsWrapper.innerHTML = '';
    currentImages.forEach((src, i) => {
      if (hiddenGalleryEl) hiddenGalleryEl.insertAdjacentHTML('beforeend', `<figure><a href="${src}" data-size=""><img src="${src}" alt=""></a></figure>`);
      if (thumbsWrapper) thumbsWrapper.insertAdjacentHTML('beforeend', `<div class="swiper-slide itmSImg" data-index="${i}"><a href="${src}" data-popup="${src}" data-size=""><img class="thumb" src="${src}" alt=""></a></div>`);
    });
    // attach click handlers to thumbs
    const thumbSlides = document.querySelectorAll('#thumbsVertical .swiper-slide');
    thumbSlides.forEach((el, idx) => {
      el.addEventListener('click', function(e){
        e.preventDefault();
        showImage(idx);
      });
    });
    // init or update Swiper for vertical thumbnails
    try {
      if (window.Swiper) {
        if (!window._modalThumbsSwiper) {
          window._modalThumbsSwiper = new Swiper('#thumbsVertical', {
            direction: 'vertical',
            slidesPerView: 4,
            spaceBetween: 24,
            navigation: {
              nextEl: '.vertNavigation .next',
              prevEl: '.vertNavigation .prev',
            },
            breakpoints: {
              250:{ direction: 'horizontal', spaceBetween:0, slidesPerView: 1 },
              330:{ direction: 'horizontal', spaceBetween:30, slidesPerView: 2 },
              480:{ direction: 'horizontal', spaceBetween:30, slidesPerView: 3 },
              730:{ direction: 'horizontal', spaceBetween:30, slidesPerView: 4 }
            }
          });
        } else {
          window._modalThumbsSwiper.update();
        }
      }
    } catch (e) {
      console.warn('Swiper init failed', e);
    }
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  function nextImage() {
    showImage(currentIndex + 1);
  }

  function prevImage() {
    showImage(currentIndex - 1);
  }

  // Закриття по кліку поза вікном
  window.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  // Закриття по ESC і перелистування стрілками
  document.addEventListener('keydown', function (e) {
    if (modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft') prevImage();
    if (e.key === 'ArrowRight') nextImage();
  });

  // SWIPE для всієї області .modal-gallery на мобільних (додаємо лише один раз!)
  (function enableSwipe() {
    let touchStartX = null;
    let touchStartY = null;
    modalGallery.addEventListener('touchstart', function(e) {
      if (window.innerWidth > 900) return;
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].screenX;
        touchStartY = e.touches[0].screenY;
      }
    });
    modalGallery.addEventListener('touchend', function(e) {
      if (window.innerWidth > 900) return;
      if (touchStartX === null) return;
      let touchEndX = e.changedTouches[0].screenX;
      let touchEndY = e.changedTouches[0].screenY;
      if (Math.abs(touchEndX - touchStartX) > 50 && Math.abs(touchEndY - touchStartY) < 60) {
        if (touchEndX - touchStartX > 0) {
          prevImage();
        } else {
          nextImage();
        }
      }
      touchStartX = null;
      touchStartY = null;
    });
  })();
document.getElementById('sizeLink').addEventListener('click', function(e) {
  e.preventDefault();
  const target = document.querySelector(this.getAttribute('href'));
  if (target) {
    target.scrollIntoView({ behavior: 'smooth' });
    closeModal(); // якщо хочеш, щоб модалка закривалась при переході
  }
});
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
      const size = defaultSize;
      return `<figure><a href="${src}" data-size="${size}"><img src="${src}" alt=""></a></figure>`;
    })
    .join('');
}

// Update main image, clone and thumbs state
function setImage(idx) {
  if (!currentImages.length) return;
  currentIndex = (idx + currentImages.length) % currentImages.length;

  const mainImg = document.getElementById('globalImage');
  const cloneImg = document.querySelector('.cloneImg .clone');
  const src = currentImages[currentIndex];

  if (mainImg) {
    mainImg.src = src;
    mainImg.dataset.large = src;
  }
  if (cloneImg) {
    cloneImg.src = src;
  }

  const slides = document.querySelectorAll('#thumbsVertical .swiper-slide');
  slides.forEach((s, i) => {
    if (i === currentIndex) s.classList.add('active');
    else s.classList.remove('active');
  });

  if (thumbsSwiper) {
    thumbsSwiper.slideTo(currentIndex);
  }

  // Оновлюємо PhotoSwipe тільки якщо галерея відкрита (перевіряємо через framework)
  if (pswp && pswp.framework && pswp.framework.isOpen) {
    try {
      pswp.goTo(currentIndex);
    } catch(e) {
      console.warn('PhotoSwipe goTo error:', e);
    }
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
        <a href="javascript:void(0)"><img class="thumb" src="${src}" alt="Photo ${i + 1}"></a>
      </div>`
    );
  });
  
  // Додаємо обробники кліків на кожну мініатюру
  setTimeout(() => {
    const thumbSlides = document.querySelectorAll('#thumbsVertical .swiper-slide');
    thumbSlides.forEach((slide, index) => {
      slide.addEventListener('click', function(e) {
        e.preventDefault();
        setImage(index);
      });
    });
  }, 50);
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
  
  // Обробка статусу наявності
  const inStock = card.dataset.inStock || 'В наявності';
  const inStock1 = card.dataset.inStock1 || ''; // Додатковий статус за розміром (наприклад: "Закінчується S")
  const orderBtn = document.getElementById('orderBtn');
  
  // Зберігаємо основний та розмірно-залежний статус для подальшого використання
  modal.dataset.mainStatus = inStock;
  modal.dataset.sizeStatus = inStock1;
  
  if (statusEl) {
    statusEl.textContent = inStock;
    if (inStock === 'Продано') {
      statusEl.style.color = '';
      statusEl.classList.remove('yes', 'pre');
      statusEl.classList.add('no');
      // Блокуємо кнопку придбати
      if (orderBtn) {
        orderBtn.disabled = true;
        orderBtn.style.opacity = '0.5';
        orderBtn.style.cursor = 'not-allowed';
      }
    } else if (inStock === 'Закінчується') {
      statusEl.style.color = '';
      statusEl.classList.remove('yes', 'no');
      statusEl.classList.add('pre');
      // Розблоковуємо кнопку придбати
      if (orderBtn) {
        orderBtn.disabled = false;
        orderBtn.style.opacity = '';
        orderBtn.style.cursor = '';
      }
    } else {
      statusEl.style.color = '';
      statusEl.classList.remove('no', 'pre');
      statusEl.classList.add('yes');
      // Розблоковуємо кнопку придбати
      if (orderBtn) {
        orderBtn.disabled = false;
        orderBtn.style.opacity = '';
        orderBtn.style.cursor = '';
      }
    }
  }

  // Парсинг розмірів або об'єму з description
  const description = card.dataset.description || '';
  const sizesContainer = document.getElementById('modalSizesContainer');
  const sizesTitle = sizesContainer ? sizesContainer.querySelector('.title span') : null;
  const sizesBox = document.getElementById('modalSizes');
  
  if (sizesContainer && sizesBox) {
    // Шукаємо "Розміри:" або "Обʼєм:"
    const sizesMatch = description.match(/Розміри:\s*([^\n&#]+)/i);
    const volumeMatch = description.match(/Обʼєм:\s*([^\n&#]+)/i);
    
    // Перевіряємо чи статус "Продано" - тоді всі розміри disabled
    const isSoldOut = inStock === 'Продано';
    
    if (volumeMatch) {
      // Є об'єм замість розмірів
      const volume = volumeMatch[1].trim();
      if (sizesTitle) sizesTitle.textContent = 'Обʼєм';
      sizesBox.innerHTML = `
        <div class="varInpt">
          <input type="radio" name="size" value="${volume}" id="size-volume" ${isSoldOut ? 'disabled' : 'checked'}>
          <label for="size-volume" ${isSoldOut ? 'class="disabled"' : ''}>${volume}</label>
        </div>
      `;
      sizesContainer.style.display = '';
    } else if (sizesMatch) {
      // Є розміри
      const sizesText = sizesMatch[1].trim();
      if (sizesTitle) sizesTitle.textContent = 'Розмір';
      
      // Всі можливі розміри
      const allSizes = ['S', 'M', 'L'];
      
      // Парсимо доступні розміри
      let availableSizes = [];
      
      // Перевіряємо чи є "(5 шт)" або подібне (один розмір з кількістю)
      const singleSizeMatch = sizesText.match(/^(\w+)\s*\([^)]+\)$/);
      
      if (singleSizeMatch) {
        // Тільки один розмір, наприклад "S (5 шт)"
        availableSizes = [singleSizeMatch[1]];
      } else {
        // Кілька розмірів, наприклад "S, M, L"
        availableSizes = sizesText.split(',').map(s => s.trim()).filter(Boolean);
      }
      
      // Генеруємо всі розміри, але деякі з них disabled
      sizesBox.innerHTML = allSizes.map((size, idx) => {
        let isDisabled = false;
        let isChecked = false;
        
        // Якщо товар "Продано" - всі розміри disabled
        if (isSoldOut) {
          isDisabled = true;
        } else {
          // Інакше дивимось на наявність розміру
          const isAvailable = availableSizes.includes(size);
          isDisabled = !isAvailable;
          isChecked = idx === 0 && isAvailable; // Перший доступний розмір за замовчуванням
        }
        
        return `
          <div class="varInpt">
            <input 
              type="radio" 
              name="size" 
              value="${size}" 
              id="size-${size.toLowerCase()}" 
              ${isDisabled ? 'disabled' : (isChecked ? 'checked' : '')}
            >
            <label for="size-${size.toLowerCase()}" ${isDisabled ? 'class="disabled"' : ''}>${size}</label>
          </div>
        `;
      }).join('');
      sizesContainer.style.display = '';
    } else {
      // Немає ні розмірів, ні об'єму - ховаємо блок
      sizesContainer.style.display = 'none';
    }
  }

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

  // Додаємо обробник зміни розміру для dynamically update статусу
  setTimeout(() => {
    addSizeChangeListener();
  }, 50);

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    initSwiper();
    initPhotoSwipe();
  }, 100);
}

// Функція для додання обробника зміни розміру
function addSizeChangeListener() {
  const sizeInputs = document.querySelectorAll('input[name="size"]');
  const modal = document.getElementById('productModal');
  
  sizeInputs.forEach(input => {
    // Видаляємо старих обробників
    input.removeEventListener('change', handleSizeChange);
    // Додаємо новий обробник
    input.addEventListener('change', handleSizeChange);
  });
}

// Функція для оновлення статусу при зміні розміру
function handleSizeChange(e) {
  const selectedSize = e.target.value;
  const modal = document.getElementById('productModal');
  const mainStatus = modal.dataset.mainStatus || 'В наявності';
  const sizeStatus = modal.dataset.sizeStatus || '';
  const statusEl = document.getElementById('modalStatus');
  
  if (!statusEl || !sizeStatus) return;
  
  // Парсимо sizeStatus - формат: "Закінчується S" або "Закінчується M, L" тощо
  const statusParts = sizeStatus.split(' ');
  const statusText = statusParts[0]; // "Закінчується"
  const affectedSizes = statusParts.slice(1).join(' ').split(',').map(s => s.trim());
  
  // Перевіряємо чи обраний розмір входить в список обмежених розмірів
  if (affectedSizes.includes(selectedSize)) {
    // Змінюємо статус на жовтий з текстом статусу
    statusEl.textContent = statusText;
    statusEl.classList.remove('yes', 'no');
    statusEl.classList.add('pre');
  } else {
    // Повертаємо основний статус
    statusEl.textContent = mainStatus;
    if (mainStatus === 'Продано') {
      statusEl.classList.remove('yes', 'pre');
      statusEl.classList.add('no');
    } else {
      statusEl.classList.remove('no', 'pre');
      statusEl.classList.add('yes');
    }
  }
}

function initSwiper() {
  if (!window.Swiper) return;

  try {
    if (thumbsSwiper) {
      thumbsSwiper.destroy(true, true);
      thumbsSwiper = null;
    }

    const vertical = window.innerWidth > 1200;
    thumbsSwiper = new Swiper('#thumbsVertical', {
      direction: vertical ? 'vertical' : 'horizontal',
      slidesPerView: vertical ? 4 : 'auto',
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
      },
      observer: true,
      observeParents: true,
      observeSlideChildren: true
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

// Обробник зміни розміру вікна
let resizeTimeout;
window.addEventListener('resize', function() {
  const modal = document.getElementById('productModal');
  if (!modal || modal.classList.contains('hidden')) return;
  
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (thumbsSwiper) {
      initSwiper();
    }
  }, 250);
});

// Закриття модального вікна при кліку на посилання розмірної сітки
document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'sizeLink') {
    closeModal();
  }
});

// Обробники кліків на стрілки навігації
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('arrow')) {
    if (e.target.classList.contains('prev')) {
      prevImage();
    } else if (e.target.classList.contains('next')) {
      nextImage();
    }
  }
});

function initPhotoSwipe() {
  if (!window.PhotoSwipe || !window.PhotoSwipeUI_Default) {
    console.warn('PhotoSwipe not loaded');
    return;
  }

  const pswpEl = document.querySelector('.pswp');
  if (!pswpEl) {
    console.warn('PhotoSwipe DOM element (.pswp) not found');
    return;
  }
  
  if (!currentImages.length) {
    console.warn('No images to display in PhotoSwipe');
    return;
  }

  // Функція для створення та відкриття PhotoSwipe
  const openPhotoSwipe = function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const items = currentImages.map((src) => {
      // Завантажуємо зображення для отримання реальних розмірів
      const img = new Image();
      img.src = src;
      return {
        src: src,
        w: img.naturalWidth || 1024,
        h: img.naturalHeight || 1365,
        title: ''
      };
    });

    // Закриваємо попередній екземпляр якщо існує
    if (pswp) {
      try {
        pswp.close();
      } catch(e) {
        console.warn('Error closing previous PhotoSwipe instance:', e);
      }
      pswp = null;
    }

    // Створюємо новий екземпляр PhotoSwipe
    try {
      pswp = new PhotoSwipe(pswpEl, PhotoSwipeUI_Default, items, {
        index: currentIndex,
        history: false,
        focus: false,
        showAnimationDuration: 0,
        hideAnimationDuration: 0,
        closeOnScroll: false,
        closeOnVerticalDrag: false,
        escKey: true,
        arrowKeys: true,
        clickToCloseNonZoomable: false
      });

      // Обробники подій PhotoSwipe
      pswp.listen('afterChange', function() {
        const newIndex = pswp.getCurrentIndex();
        if (newIndex !== currentIndex) {
          setImage(newIndex);
        }
      });

      pswp.listen('close', function() {
        pswp = null;
        // PhotoSwipe встановлює overflow: auto при закритті, тому скидаємо це
        setTimeout(() => {
          document.body.style.removeProperty('overflow');
        }, 0);
      });

      // Ініціалізуємо та відкриваємо PhotoSwipe
      pswp.init();

    } catch(err) {
      console.error('Error creating PhotoSwipe instance:', err);
      pswp = null;
    }
  };

  // Клік по головному зображенню відкриває галерею
  const mainImg = document.getElementById('globalImage');
  if (mainImg) {
    mainImg.style.cursor = 'pointer';
    mainImg.onclick = openPhotoSwipe;
  }

  // Клік по контейнеру image відкриває галерею
  const imageContainer = document.querySelector('.bigImage .image');
  if (imageContainer) {
    imageContainer.style.cursor = 'pointer';
    imageContainer.onclick = openPhotoSwipe;
  }

  // Клік по клонованому зображенню відкриває галерею
  const cloneImg = document.querySelector('.cloneImg');
  if (cloneImg) {
    cloneImg.style.cursor = 'pointer';
    cloneImg.onclick = openPhotoSwipe;
  }
}

function closeModal() {
  const modal = document.getElementById('productModal');
  if (modal) modal.classList.add('hidden');

  if (thumbsSwiper) {
    thumbsSwiper.destroy(true, true);
    thumbsSwiper = null;
  }

  if (pswp) {
    pswp.close();
    pswp = null;
  }
  
  // Видаляємо overflow після того як PhotoSwipe закриється
  setTimeout(() => {
    document.body.style.removeProperty('overflow');
  }, 50);
}

function nextImage() {
  setImage(currentIndex + 1);
}

function prevImage() {
  setImage(currentIndex - 1);
}

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
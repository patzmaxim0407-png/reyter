// home-collection.js
const homeCollectionBtn = document.getElementById('homeCollectionBtn');
const homeCollection = document.getElementById('homeCollection');

homeCollectionBtn?.addEventListener('click', () => {
  const isOpen = homeCollection.classList.toggle('show');
  homeCollectionBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});

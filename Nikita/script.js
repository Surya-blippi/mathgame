/* ============================================
   ClearSoup — JavaScript Interactions
   ============================================ */

// Navbar scroll effect
const navbar = document.getElementById('navbar');
let lastScroll = 0;

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    
    if (currentScroll > 60) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
    
    lastScroll = currentScroll;
});

// Mobile menu toggle
const mobileToggle = document.getElementById('mobileMenuToggle');
const mobileMenu = document.getElementById('mobileMenu');

if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', () => {
        mobileToggle.classList.toggle('active');
        mobileMenu.classList.toggle('active');
        document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
    });

    // Close menu on link click
    mobileMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            mobileToggle.classList.remove('active');
            mobileMenu.classList.remove('active');
            document.body.style.overflow = '';
        });
    });
}

// Intersection Observer for reveal animations
const revealElements = document.querySelectorAll(
    '.about-grid, .about-label, .about-content, ' +
    '.story-content, ' +
    '.authority-left, .authority-right, ' +
    '.framework-header, .framework-step, ' +
    '.philosophy-header, .pillars-equation, .pillar-card, ' +
    '.testimonials-header, .testimonial-card, ' +
    '.contact-left, .contact-right'
);

const observerOptions = {
    root: null,
    rootMargin: '0px 0px -60px 0px',
    threshold: 0.1
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
            // Stagger the animation slightly based on position
            setTimeout(() => {
                entry.target.classList.add('visible');
            }, index * 80);
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

revealElements.forEach(el => {
    el.classList.add('reveal');
    observer.observe(el);
});

// Smooth scroll for nav links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

// Contact form handling
const contactForm = document.getElementById('contactForm');
if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = document.getElementById('formSubmit');
        const originalText = btn.textContent;
        
        btn.textContent = 'Message Sent! ✓';
        btn.style.background = '#5da67a';
        btn.disabled = true;
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
            btn.disabled = false;
            contactForm.reset();
        }, 3000);
    });
}

// Hero image fallback — if Nikita's photo isn't found, create a styled placeholder
const heroImg = document.getElementById('heroImg');
if (heroImg) {
    heroImg.addEventListener('error', () => {
        const wrapper = heroImg.parentElement;
        heroImg.style.display = 'none';
        
        const placeholder = document.createElement('div');
        placeholder.style.cssText = `
            width: 100%;
            aspect-ratio: 3/4;
            border-radius: 32px;
            background: linear-gradient(135deg, #4A7C8A 0%, #6BA3B3 50%, #C09B7C 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            z-index: 1;
            box-shadow: 0 30px 60px rgba(42,48,56,0.12);
        `;
        
        const initials = document.createElement('span');
        initials.textContent = 'NA';
        initials.style.cssText = `
            font-family: 'Cormorant Garamond', serif;
            font-size: 5rem;
            font-weight: 300;
            color: rgba(255,255,255,0.9);
            letter-spacing: 0.05em;
        `;
        
        placeholder.appendChild(initials);
        wrapper.appendChild(placeholder);
    });
}

// Parallax subtle effect on story banner
window.addEventListener('scroll', () => {
    const banner = document.querySelector('.story-banner');
    if (banner) {
        const rect = banner.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        
        if (rect.top < windowHeight && rect.bottom > 0) {
            const progress = (windowHeight - rect.top) / (windowHeight + rect.height);
            const overlay = banner.querySelector('.story-banner-overlay');
            if (overlay) {
                overlay.style.background = `linear-gradient(${135 + progress * 30}deg, rgba(74, 124, 138, ${0.1 + progress * 0.1}), transparent)`;
            }
        }
    }
});

// Add number counter animation for framework steps
const stepNumbers = document.querySelectorAll('.step-number');
const stepObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.animation = 'stepPop 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards';
            stepObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

stepNumbers.forEach(el => stepObserver.observe(el));

// Add CSS for step pop animation 
const style = document.createElement('style');
style.textContent = `
    @keyframes stepPop {
        0% { transform: scale(0.5); opacity: 0; }
        60% { transform: scale(1.15); }
        100% { transform: scale(1); opacity: 1; }
    }
`;
document.head.appendChild(style);

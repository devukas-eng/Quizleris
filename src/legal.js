import { playClick } from "./audio.js";

const PRIVACY_TEXT = `
<h3>Privacy Policy</h3>
<p><strong>Last Updated:</strong> June 2026</p>
<p>Welcome to Quizleris. Your privacy is critically important to us. This Privacy Policy governs the manner in which Quizleris collects, uses, maintains and discloses information collected from users of the website.</p>
<h4>1. Information Collection</h4>
<p>Since Quizleris is a 100% client-side application, <strong>we do not collect, store, or transmit your personal data to any external servers.</strong><br>
All data, including quiz scores, player profiles (XP/Levels), and custom created quizzes, are stored entirely locally within your browser using <code>localStorage</code>.</p>
<h4>2. Cookies and Local Storage</h4>
<p>We use <code>localStorage</code> to save your progress. This acts similarly to a cookie but never leaves your device. By using the app, you consent to this local data retention.</p>
<h4>3. Analytics</h4>
<p>We may use completely anonymous, privacy-respecting analytics to track general usage strictly for improving the application. No personally identifiable information (PII) is recorded.</p>
<h4>4. Data Deletion & Contact</h4>
<p>Because your data is stored locally on your device, you can delete it at any time by clearing your browser cache/storage.<br>
For any specific requests, legal inquiries, or formal data deletion requests, please contact our support team at:<br>
<strong>Email: <a href="mailto:eblogsmod@gmail.com">eblogsmod@gmail.com</a></strong></p>
`;

const TERMS_TEXT = `
<h3>Terms of Service</h3>
<p><strong>Last Updated:</strong> June 2026</p>
<p>By accessing or using Quizleris, you agree to be bound by these Terms of Service.</p>
<h4>1. Use of the Application</h4>
<p>Quizleris is provided "as is" for educational and entertainment purposes. You agree not to use the application for any unlawful purpose or in any way that might harm, damage, or disparage any other party.</p>
<h4>2. User-Generated Content</h4>
<p>If you use the Admin features to create custom quizzes, you are solely responsible for the content you create. Quizleris takes no responsibility for user-generated content, as it is stored locally on your device and not hosted on our servers.</p>
<h4>3. Intellectual Property</h4>
<p>The Quizleris platform, its original content, features, and functionality are owned by its creators and are protected by international copyright, trademark, patent, trade secret, and other intellectual property laws.</p>
<h4>4. Contact Us</h4>
<p>If you have any questions about these Terms, please contact us at:<br>
<strong>Email: <a href="mailto:eblogsmod@gmail.com">eblogsmod@gmail.com</a></strong></p>
`;

const COOKIES_TEXT = `
<h3>Cookie Policy</h3>
<p><strong>Last Updated:</strong> June 2026</p>
<h4>What are Cookies?</h4>
<p>Cookies are small files saved to your device that track, save, and store information about your interactions and usage of the website.</p>
<h4>How Quizleris uses Local Data</h4>
<p>Quizleris uses HTML5 <code>localStorage</code> instead of traditional cookies. This allows us to save your:</p>
<ul>
<li>High Scores and XP</li>
<li>Current Theme (Light/Dark mode)</li>
<li>Custom created quizzes</li>
</ul>
<p>without ever sending this data to a remote server.</p>
<h4>Managing your data</h4>
<p>If you wish to remove all data Quizleris has saved, you can simply clear your browser's site data. If you need assistance with data policies, contact us at:<br>
<strong>Email: <a href="mailto:eblogsmod@gmail.com">eblogsmod@gmail.com</a></strong></p>
`;

export function showLegalModal() {
    playClick();
    
    let modalRoot = document.getElementById('legal-modal-root');
    if (!modalRoot) {
        modalRoot = document.createElement('div');
        modalRoot.id = 'legal-modal-root';
        document.body.appendChild(modalRoot);
    }
    
    modalRoot.innerHTML = `
        <div class="legal-modal-overlay">
            <div class="legal-modal-card">
                <div class="legal-header">
                    <h2>Legal & Compliance</h2>
                    <button id="legal-close-btn" class="legal-close">&times;</button>
                </div>
                
                <div class="legal-tabs">
                    <button class="legal-tab active" data-target="privacy">Privacy Policy</button>
                    <button class="legal-tab" data-target="terms">Terms of Service</button>
                    <button class="legal-tab" data-target="cookies">Cookie Policy</button>
                </div>
                
                <div class="legal-content-area">
                    <div id="legal-content-privacy" class="legal-pane active">
                        ${PRIVACY_TEXT}
                    </div>
                    <div id="legal-content-terms" class="legal-pane" style="display: none;">
                        ${TERMS_TEXT}
                    </div>
                    <div id="legal-content-cookies" class="legal-pane" style="display: none;">
                        ${COOKIES_TEXT}
                    </div>
                </div>
                
                <div class="legal-footer">
                    <p>Questions? Contact <strong>eblogsmod@gmail.com</strong></p>
                </div>
            </div>
        </div>
    `;

    document.getElementById('legal-close-btn').onclick = () => {
        playClick();
        modalRoot.innerHTML = '';
    };

    const tabs = modalRoot.querySelectorAll('.legal-tab');
    tabs.forEach(tab => {
        tab.onclick = () => {
            playClick();
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            modalRoot.querySelectorAll('.legal-pane').forEach(p => p.style.display = 'none');
            document.getElementById('legal-content-' + tab.dataset.target).style.display = 'block';
        };
    });
}

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const session = require('express-session'); // Voor sessiebeheer
const bcrypt = require('bcrypt'); // Voor wachtwoord hashing

const app = express();
const PORT = 3000;

// Stel de views directory en view engine in
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware voor statische bestanden (CSS, afbeeldingen, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Body-parser middleware voor het verwerken van POST-verzoeken
app.use(bodyParser.urlencoded({ extended: true }));

// Sessieconfiguratie
app.use(session({
    secret: 'jouw_geheime_sleutel', // Verander deze in een complexe string
    resave: false,
    saveUninitialized: true,
}));

// MySQL-configuratie
const db = mysql.createConnection({
    host: 'localhost',
    user: 'admin',      // Vervang door jouw MySQL-gebruikersnaam
    password: 'password',  // Vervang door jouw MySQL-wachtwoord
    database: 'kktoe' // Vervang door jouw MySQL-database naam
});

// Verbinding maken met de database
db.connect((err) => {
    if (err) {
        console.error('Fout bij het verbinden met de database: ' + err.stack);
        return;
    }
    console.log('Verbonden met de MySQL database als ID ' + db.threadId);
});

// Route voor de hoofdpagina (omleiden naar inlogpagina)
app.get('/', (req, res) => {
    res.redirect('/login'); // Omleiden naar de inlogpagina
});

// Route voor de inlogpagina
app.get('/login', (req, res) => {
    res.render('login', { errorMessage: req.session.errorMessage }); // Stuur foutmeldingen mee
    req.session.errorMessage = null; // Reset de foutmelding
});

// Route voor inloggen
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // Hier zou je de gebruiker uit de database ophalen
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err) {
            console.error(err);
            return res.redirect('/login');
        }
        
        if (results.length > 0) {
            const user = results[0];

            // Vergelijk het ingevoerde wachtwoord met het gehashed wachtwoord in de database
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                req.session.user = user; // Sla de gebruiker op in de sessie
                return res.redirect('/dashboard');
            }
        }

        req.session.errorMessage = 'Ongeldige inloggegevens, probeer het opnieuw.';
        return res.redirect('/login');
    });
});

app.post('/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Has het wachtwoord met een salt factor van 10
        const hashedPassword = await bcrypt.hash(password, 10);

        // Sla de nieuwe gebruiker op in de database
        db.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword], (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Fout bij het registreren van de gebruiker.');
            }
            res.send('Gebruiker succesvol geregistreerd');
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Er is een fout opgetreden bij het hashen van het wachtwoord.');
    }
});


// Route voor Dashboard
app.get('/dashboard', (req, res) => {
    // Controleer of de gebruiker is ingelogd
    if (!req.session.user) {
        return res.redirect('/login'); // Omleiden naar inlogpagina als de gebruiker niet is ingelogd
    }
    res.render('dashboard', { title: 'Welkom bij Mijn KKTOE Dashboard' });
});

// Route voor Mijn Account pagina
app.get('/account', (req, res) => {
    res.render('account', { title: 'Mijn Account' });
});

// Route voor Rooster pagina
app.get('/rooster', (req, res) => {
    res.render('rooster', { title: 'Rooster' });
});

// Route voor Intekenen op diensten pagina
app.get('/intekenen', (req, res) => {
    const dataBeschikbaar = [
        '10 oktober 2024',
        '15 oktober 2024',
        '20 oktober 2024',
        '25 oktober 2024'
    ];
    res.render('intekenen', { title: 'Intekenpagina', dataBeschikbaar });
});

// Route voor Mijn Diensten pagina
app.get('/mijn-diensten', (req, res) => {
    res.render('mijn-diensten', { title: 'Mijn Diensten' });
});

// Route voor Mijn Gegevens pagina
app.get('/mijn-gegevens', (req, res) => {
    res.render('mijn-gegevens', { title: 'Mijn Gegevens' });
});

// Route voor het verwerken van de inschrijving
app.post('/inschrijven', (req, res) => {
    const geselecteerdeDatum = req.body.datum;

    // Hier zou je een database-insert kunnen uitvoeren
    res.send(`Je hebt je succesvol ingeschreven voor: ${geselecteerdeDatum}`);
});

// Route voor de registratiepagina
app.get('/register', (req, res) => {
    res.render('register', { errorMessage: null }); // Render de registratiepagina
});

// Route voor het verwerken van de registratiegegevens
app.post('/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Controleer of de gebruiker al bestaat
        db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Fout bij het controleren van de gebruiker.');
            }

            if (results.length > 0) {
                return res.render('register', { errorMessage: 'E-mailadres is al in gebruik.' });
            }

            // Has het wachtwoord met bcrypt (gebruik een salt factor van 10)
            const hashedPassword = await bcrypt.hash(password, 10);

            // Voeg de nieuwe gebruiker toe aan de database
            db.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword], (err, results) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Fout bij het registreren van de gebruiker.');
                }
                // Redirect naar de login pagina na succesvolle registratie
                res.redirect('/login');
            });
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Er is een fout opgetreden bij het registreren van de gebruiker.');
    }
});

// Fallback route voor pagina's die niet bestaan
app.get('*', (req, res) => {
    res.status(404).send('Pagina niet gevonden');
});

// Start de server
app.listen(PORT, () => {
    console.log(`Server draait op http://localhost:${PORT}`);
});

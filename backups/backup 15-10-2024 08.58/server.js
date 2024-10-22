const express = require('express'); 
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const session = require('express-session');
const bcrypt = require('bcrypt');

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
    secret: 'jouw_geheime_sleutel',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Zet dit op true als je HTTPS gebruikt
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

// Middelware voor rolcontrole
function checkRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
            return res.status(403).send('Toegang geweigerd. Onvoldoende rechten.');
        }
        next();
    };
}

// Route voor de hoofdpagina (omleiden naar inlogpagina)
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Route voor de inlogpagina
app.get('/login', (req, res) => {
    res.render('login', { errorMessage: req.session.errorMessage });
    req.session.errorMessage = null;
});

// Route voor inloggen
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // Haal de gebruiker op met de bijbehorende rol uit de database
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err) {
            console.error(err);
            return res.redirect('/login');
        }

        if (results.length > 0) {
            const user = results[0];

            // Vergelijk het ingevoerde wachtwoord met het gehashte wachtwoord in de database
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                // Sla de gebruiker op in de sessie, inclusief hun rol
                req.session.user = {
                    id: user.id,
                    email: user.email,
                    role: user.role // Voeg de rol toe aan de sessie
                };
                return res.redirect('/dashboard');
            }
        }

        req.session.errorMessage = 'Ongeldige inloggegevens, probeer het opnieuw.';
        return res.redirect('/login');
    });
});

// Route voor het admin dashboard
app.get('/admin-dashboard', checkRole(['administrator']), (req, res) => {
    res.render('admin-dashboard', { title: 'Admin Dashboard' });
});

// Route voor Dashboard
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Controleer of de gebruiker ingelogd is
    }
    res.render('dashboard', { title: 'Welkom bij Mijn KKTOE Dashboard', user: req.session.user });
});

// Route voor Intekenen op diensten
app.get('/intekenen', checkRole(['techniek', 'kktoe', 'administrator']), (req, res) => {
    const userRole = req.session.user.role;

    // Halen diensten op voor de respectieve rol
    db.query('SELECT * FROM diensten WHERE afdeling = ?', [userRole], (err, results) => {
        if (err) {
            console.error('Fout bij het ophalen van diensten: ', err);
            return res.status(500).send('Fout bij het ophalen van diensten.');
        }

        res.render('intekenen', { title: 'Intekenpagina', diensten: results });
    });
});

// Route voor het verwerken van de inschrijving (POST-verzoek)
app.post('/intekenen', checkRole(['techniek', 'kktoe', 'administrator']), (req, res) => {
    const geselecteerdeDiensten = req.body.dienst; // Verkrijg de geselecteerde diensten uit het formulier
    const userId = req.session.user.id;

    if (!geselecteerdeDiensten) {
        return res.status(400).send('Selecteer ten minste één dienst.');
    }

    // Controleer of er meerdere diensten zijn geselecteerd
    const geselecteerdeDienstenArray = Array.isArray(geselecteerdeDiensten) ? geselecteerdeDiensten : [geselecteerdeDiensten];

    geselecteerdeDienstenArray.forEach((dienstId) => {
        // Sla de inschrijving op in de database
        db.query('INSERT INTO diensten (user_id, dienst_id) VALUES (?, ?)', [userId, dienstId], (err) => {
            if (err) {
                console.error('Fout bij het inschrijven: ', err);
                return res.status(500).send('Fout bij het verwerken van de inschrijving.');
            }
        });
    });

    res.send('Je inschrijving is succesvol verwerkt.');
});

// Route voor het bekijken van openstaande diensten
app.get('/openstaande-diensten', (req, res) => {
    // Query om alleen diensten met user_id NULL op te halen
    db.query('SELECT * FROM diensten WHERE user_id IS NULL', (error, results) => {
        if (error) {
            console.error('Fout bij het ophalen van diensten:', error);
            return res.status(500).send('Fout bij het ophalen van diensten.');
        }

        // Log de resultaten in de console om te controleren of de query correct werkt
        console.log('Resultaten van query:', results);

        // Als er geen diensten worden gevonden met user_id NULL
        if (results.length === 0) {
            return res.render('openstaande-diensten', { diensten: [], message: 'Geen openstaande diensten gevonden.' });
        }

        // Render de resultaten in de openstaande-diensten.ejs template
        res.render('openstaande-diensten', { diensten: results, message: '' });
    });
});

// Route voor het opslaan van ingetekende diensten
app.post('/diensten/inschrijven', (req, res) => {
    const geselecteerdeDienstIds = req.body.dienst_ids; // Dit zijn de dienst_id's uit het formulier
    const gebruikerEmail = req.user.email; // Haal het e-mailadres van de ingelogde gebruiker op

    // Log om te controleren of de juiste gegevens binnenkomen
    console.log('Geselecteerde diensten:', geselecteerdeDienstIds);
    console.log('Ingelogde gebruiker email:', gebruikerEmail);

    if (!geselecteerdeDienstIds || geselecteerdeDienstIds.length === 0) {
        return res.status(400).send('Geen diensten geselecteerd.');
    }

    // SQL query: Werk de diensten bij met het e-mailadres van de gebruiker
    const query = 'UPDATE diensten SET user_id = (SELECT id FROM users WHERE email = ?) WHERE id IN (?)';

    db.query(query, [gebruikerEmail, geselecteerdeDienstIds], (err, result) => {
        if (err) {
            console.error('Fout bij het updaten van de diensten:', err);
            return res.status(500).send('Fout bij het opslaan van de diensten.');
        }

        // Redirect of toon een succesbericht
        res.redirect('/openstaande-diensten');
    });
});

// Route voor het aanmaken van een nieuwe dienst
app.post('/diensten-aanmaken', (req, res) => {
    const { weekdag, datum, activiteit, soort_dienst, aanvang, einde } = req.body;

    const sql = 'INSERT INTO diensten (weekdag, datum, activiteit, soort_dienst, aanvang, einde) VALUES (?, ?, ?, ?, ?, ?)';
    
    db.query(sql, [weekdag, datum, activiteit, soort_dienst, aanvang, einde], (err, result) => {
        if (err) {
            console.error('Fout bij het toevoegen van de dienst: ', err);
            return res.status(500).send('Er is een fout opgetreden bij het aanmaken van de dienst.');
        }
        res.redirect('/diensten-beheren');
    });
});

// Route voor het bekijken van gebruikers
app.get('/gebruikers', checkRole(['administrator']), (req, res) => {
    db.query('SELECT * FROM users', (err, results) => {
        if (err) {
            console.error('Fout bij het ophalen van gebruikers: ', err);
            return res.status(500).send('Fout bij het ophalen van gebruikers.');
        }
        res.render('gebruikers', { title: 'Gebruikersbeheer', gebruikers: results });
    });
});

// Route voor het aanmaken van gebruikers via de gebruikers-beheer pagina
app.get('/gebruiker-aanmaken', (req, res) => {
    res.render('gebruiker-aanmaken', { title: 'Nieuwe Gebruiker Aanmaken' });
});

// Haal de gebruikers op in Admin-gebruikersbeheer
app.get('/admin/gebruikers', (req, res) => {
    const gebruikers = [
        { email: "example1@example.com", role: "student", naam: "Junte Boekhoorn", telefoonnummer: "0616770157", klas: "4V2", coach: "Mevrouw Been" },
        // Voeg hier meer gebruikers toe
    ];
    
    res.render('gebruikers', { title: 'Beheer Gebruikers', gebruikers });
    console.log(gebruikers);
});

// Route voor het aanmaken van gebruikers via de post
app.post('/gebruiker-aanmaken', async (req, res) => {
    const { email, role, naam, telefoonnummer, klas, coach, password } = req.body;

    try {
        if (!password) {
            return res.status(400).send('Wachtwoord is verplicht.');
        }

        // Log de ontvangen gegevens voor debugging
        console.log('Ontvangen gegevens:', req.body);

        // Controleer of de e-mail al in gebruik is
        const existingUser = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).send('E-mail is al in gebruik.');
        }

        // Hash het wachtwoord met bcrypt
        const hashedPassword = await bcrypt.hash(password, 10);

        // Voeg de nieuwe gebruiker toe aan de database
        await db.query('INSERT INTO users (email, role, naam, telefoonnummer, klas, coach, password) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [email, role, naam, telefoonnummer, klas, coach, hashedPassword]);

        // Redirect naar de gebruikerspagina
        res.redirect('/gebruikers');
    } catch (error) {
        console.error('Fout bij het aanmaken van gebruiker:', error);
        res.status(500).send('Er is een fout opgetreden bij het aanmaken van de gebruiker.');
    }
});

// Route voor het afmelden
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// Start de server
app.listen(PORT, () => {
    console.log(`Server draait op http://localhost:${PORT}`);
});

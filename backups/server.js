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
        db.query('INSERT INTO inschrijvingen (user_id, dienst_id) VALUES (?, ?)', [userId, dienstId], (err) => {
            if (err) {
                console.error('Fout bij het inschrijven: ', err);
                return res.status(500).send('Fout bij het verwerken van de inschrijving.');
            }
        });
    });

    res.send('Je inschrijving is succesvol verwerkt.');
});

// Route voor het bekijken van inschrijvingen
app.get('/inschrijvingen', checkRole(['administrator']), (req, res) => {
    db.query('SELECT i.*, u.email, d.activiteit FROM inschrijvingen i JOIN users u ON i.user_id = u.id JOIN diensten d ON i.dienst_id = d.id', (err, results) => {
        if (err) {
            console.error('Fout bij het ophalen van inschrijvingen: ', err);
            return res.status(500).send('Fout bij het ophalen van inschrijvingen.');
        }
        res.render('inschrijvingen', { title: 'Inschrijvingen', inschrijvingen: results });
    });
});

// Route voor het beheren van gebruikers
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


app.get('/admin/gebruikers', (req, res) => {
    // Haal de gebruikers uit de database of een andere bron
    const gebruikers = [
        { email: "example1@example.com", role: "student", naam: "Junte Boekhoorn", telefoonnummer: "0616770157", klas: "4V2", coach: "Mevrouw Been" },
        // Voeg hier meer gebruikers toe
    ];
    
    res.render('gebruikers', { title: 'Beheer Gebruikers', gebruikers });
    console.log(gebruikers);

});

// Route voor het aanmaken van gebuikers via gebruikers-beheer
app.get('/gebruikers', (req, res) => {
    // Verkrijg gebruikers uit de database
    db.query('SELECT * FROM users', (err, resultaten) => {
        if (err) throw err;
        res.render('gebruikers', { title: 'Beheer Gebruikers', gebruikers: resultaten });
    });
});

app.post('/gebruiker-aanmaken', async (req, res) => {
    const { email, role, naam, telefoonnummer, klas, coach, password } = req.body;

    try {
        // Controleer of het wachtwoord aanwezig is
        if (!password) {
            return res.status(400).send('Wachtwoord is verplicht.');
        }

        // Log de ontvangen gegevens voor debugging
        console.log('Ontvangen gegevens:', req.body);

        // Voeg hier validatie toe voor de invoer, bijvoorbeeld controleren of het e-mailadres al bestaat
        const existingUser = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).send('E-mail is al in gebruik.');
        }

        // Hash het wachtwoord (bijvoorbeeld met bcrypt)
        const hashedPassword = await bcrypt.hash(password, 10);

        // SQL-query om de gebruiker toe te voegen aan de database
        await db.query('INSERT INTO users (email, role, naam, telefoonnummer, klas, coach, password) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [email, role, naam, telefoonnummer, klas, coach, hashedPassword]);

        // Redirect of stuur een succesbericht
        res.redirect('/gebruikers');
    } catch (error) {
        console.error('Fout bij het aanmaken van gebruiker:', error);
        res.status(500).send('Er is een fout opgetreden bij het aanmaken van de gebruiker.');
    }
});

// Route voor het beheren van Inschrijvingen
app.get('/inschrijvingen-beheren', (req, res) => {
    // Haal inschrijvingen op uit de database
    db.query('SELECT * FROM inschrijvingen', (err, results) => {
        if (err) {
            console.error('Fout bij het ophalen van inschrijvingen: ', err);
            return res.status(500).send('Fout bij het ophalen van inschrijvingen.');
        }
        res.render('inschrijvingen-beheren', {
            title: 'Inschrijvingen Beheren',
            inschrijvingen: results // Dit moet de daadwerkelijke data zijn
        });
    });
});

// Route voor het aanmaken van een nieuwe dienst via inschrijvingen
app.post('/inschrijvingen-aanmaken', (req, res) => {
    const { weekdag, datum, activiteit, soort_dienst, aanvang, einde } = req.body;

    // Voeg de nieuwe dienst toe aan de inschrijvingen-tabel
    const sql = 'INSERT INTO inschrijvingen (weekdag, datum, activiteit, soort_dienst, aanvang, einde) VALUES (?, ?, ?, ?, ?, ?)';
    
    db.query(sql, [weekdag, datum, activiteit, soort_dienst, aanvang, einde], (err, result) => {
        if (err) {
            console.error('Fout bij het toevoegen van de inschrijving: ', err);
            return res.status(500).send('Er is een fout opgetreden bij het aanmaken van de inschrijving.');
        }
        res.redirect('/inschrijvingen-beheren');
    });
});

// Route voor Mijn Account pagina
app.get('/account', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('account', { title: 'Mijn Account', user: req.session.user });
});

// Route voor Rooster pagina
app.get('/rooster', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('rooster', { title: 'Rooster', user: req.session.user });
});

// Route voor Mijn Diensten pagina
app.get('/mijn-diensten', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('mijn-diensten', { title: 'Mijn Diensten', user: req.session.user });
});

// Route voor Mijn Gegevens pagina
app.get('/mijn-gegevens', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('mijn-gegevens', { title: 'Mijn Gegevens', user: req.session.user });
});

// Route voor de registratiepagina
app.get('/register', (req, res) => {
    res.render('register', { errorMessage: null });
});

// Route voor het verwerken van de registratiegegevens
app.post('/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Fout bij het controleren van de gebruiker.');
            }

            if (results.length > 0) {
                return res.render('register', { errorMessage: 'E-mailadres is al in gebruik.' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            db.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword], (err) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Fout bij het registreren van de gebruiker.');
                }
                res.redirect('/login');
            });
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Er is een fout opgetreden bij het registreren van de gebruiker.');
    }
});

// Fallback route voor niet-bestaande pagina's
app.get('*', (req, res) => {
    res.status(404).send('Pagina niet gevonden');
});

// Start de server
app.listen(PORT, () => {
    console.log(`Server draait op http://localhost:${PORT}`);
});

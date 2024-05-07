const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

//middleware
app.use(cors());
app.use(express.json());

//mongodb
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.s3xiulm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("Doctor portal is smoothly running");
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    await client.connect();
    const serviceCollection = client
      .db("docor_portal_data")
      .collection("services");

    const appointmentCollection = client
      .db("docor_portal_data")
      .collection("booking_appointment");

    const userCollection = client.db("docor_portal_data").collection("users");
    const doctorCollection = client
      .db("docor_portal_data")
      .collection("doctors");
    const paymentCollection = client
      .db("docor_portal_data")
      .collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requestterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requestterAccount.role === "admin") {
        next();
      } 
      else {
        res.status(403).send({ message: "forbidden" });
      }
    };

 app.post('/create-payment-intent', verifyJWT, async(req, res) =>{
  const service = req.body;
  const treatmentFee  = service.treatmentFee;
  const amount = treatmentFee * 100;
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: "usd",
     payment_method_types: ['card']
});
res.json({ clientSecret: paymentIntent.client_secret })
 });


    app.get("/services", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    //Warning:
    // This is not the proper way to query;
    //After learning more about mongodb. use aggregate lookup, match, group
    app.get("/available", async (req, res) => {
      const date = req.query.date;

      //1. get all services
      const services = await serviceCollection.find().toArray();

      //2. get the booking of that day
      const query = { date: date };
      const bookedAppointment = await appointmentCollection
        .find(query)
        .toArray();

      //step-3; for Each service
      services.forEach((service) => {
        //step-4: find bookings for that service
        const serviceBookings = bookedAppointment.filter(
          (book) => book.treatmentName === service.name
        );
        //5: select slots for the service bookings
        const bookedSlots = serviceBookings.map((b) => b.schedule);
        //6
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        service.slots = available;
      });
      res.send(services);
    });

    app.get("/user", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    app.delete('/user/:email', verifyJWT, verifyAdmin, async(req, res) =>{
      const email = req.params.email;
      const filter = {email: email};
      const result = await userCollection.deleteOne(filter);
       res.send(result);
    })

    //update user
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {        
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result, token });
    });

    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email === decodedEmail) {
        const query = { email: email };
        const cursor = appointmentCollection.find(query);
        const booked = await cursor.toArray();
        res.send(booked);
      } else {
        return res.status(403).send({ message: "forbidden access" });
      }
    });

    app.get('/bookings/:id', verifyJWT, async(req, res) =>{
      const id = req.params.id;
      const  query = {_id: new ObjectId(id)};
      const bookingWithID = await appointmentCollection.findOne(query);
      res.send(bookingWithID)
    });
    app.patch('/bookings/:id', verifyJWT, async(req, res) =>{
      const id = req.params.id;
      const payment = req.body;
      const filter = {_id: new ObjectId(id)};
       const updateDoc = {
          $set: {
            paid: true,
            transactionID: payment.transactionID
          }
       }
       const result = await paymentCollection.insertOne(payment);
       const updatedBooking = await appointmentCollection.updateOne(filter, updateDoc);
       res.send(updateDoc);
    })

    //POST
    app.post("/bookings", async (req, res) => {
      const newBooking = req.body;
      const query = {
        treatmentName: newBooking.treatmentName,
        date: newBooking.date,
        patientName: newBooking.patientName,
      };
      const IsExists = await appointmentCollection.findOne(query);
      if (IsExists) {
        return res.send({ success: false, newBooking: IsExists });
      }
      const result = await appointmentCollection.insertOne(newBooking);
      return res.send({ success: true, result });
    });

    //manage doctor
    app.get("/doctor", verifyJWT, async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    });
    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });

    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Doctor Portal listening on port ${port}`);
});

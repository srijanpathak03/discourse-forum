const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { getCollections } = require('../mongoConnection');
const { ObjectId } = require('mongodb');
const User = require('../models/User');
const DiscourseUserMapping = require('../models/DiscourseUserMapping');
const axios = require('axios');

// GET route to fetch all active communities
router.get("/get-communities", async (req, res) => {
    try {
        const { communityCollection } = await getCollections();
        
        const allCommunities = await communityCollection
            .find({ status: 'active' })
            .sort({ created_at: -1 })
            .toArray();

        res.json(allCommunities);
    } catch (error) {
        console.error('Error fetching communities:', error);
        res.status(500).json({
            message: "Error fetching communities",
            status: "error",
        });
    }
});

// GET route to fetch a specific community by ID
router.get("/community/:id", async (req, res) => {
    try {
        const { communityCollection } = await getCollections();
        const communityId = req.params.id;

        const community = await communityCollection.findOne({
            _id: new ObjectId(communityId)
        });

        if (!community) {
            return res.status(404).json({
                message: "Community not found",
                status: "fail",
            });
        }

        res.json(community);
    } catch (error) {
        console.error('Error fetching community:', error);
        res.status(500).json({
            message: "Error fetching community",
            status: "error",
        });
    }
});

// POST route to create a new community
router.post("/create-community", async (req, res) => {
    try {
        const { communityCollection } = await getCollections();
        const {
            name,
            description,
            category,
            discourse_url,
            creator
        } = req.body;

        // Validate required fields
        if (!name || !description || !category || !discourse_url || !creator) {
            return res.status(400).json({
                message: "Missing required fields",
                status: "fail",
            });
        }

        const newCommunity = {
            name,
            description,
            category,
            discourse_url,
            creator,
            members_count: 0,
            created_at: new Date(),
            status: 'active',
            slug: name.toLowerCase().replace(/\s+/g, '-')
        };

        const result = await communityCollection.insertOne(newCommunity);

        res.status(201).json({
            message: "Community created successfully",
            status: "success",
            communityId: result.insertedId,
        });
    } catch (error) {
        console.error('Error creating community:', error);
        res.status(500).json({
            message: "Error creating community",
            status: "error",
        });
    }
});

// Join community route
router.post('/community/join', async (req, res) => {
  try {
    const { communityId, userId, user } = req.body;
    const { communityCollection } = await getCollections();

    console.log('Join request received:', { communityId, userId, user });

    // Check if community exists
    const community = await communityCollection.findOne({ 
      _id: new ObjectId(communityId) 
    });

    if (!community) {
      return res.status(404).json({ 
        success: false, 
        message: 'Community not found' 
      });
    }

    // Get the discourse mapping
    const mapping = await DiscourseUserMapping.findOne({
      userId,
      communityId: new ObjectId(communityId)
    });

    if (!mapping) {
      console.log('No discourse mapping found');
      return res.status(400).json({
        success: false,
        message: 'Discourse user mapping not found'
      });
    }

    console.log('Found discourse mapping:', mapping);

    try {
      // Try to find existing user by uid
      let dbUser = await User.findOne({ uid: userId });
      
      if (dbUser) {
        console.log('Updating existing user');
        // Update existing user
        dbUser = await User.findOneAndUpdate(
          { uid: userId },
          { 
            $addToSet: { communities: new ObjectId(communityId) },
            // Ensure user has email, name, etc. if they were missing
            $set: {
              email: user.email || dbUser.email,
              name: user.displayName || dbUser.name,
              photoURL: user.photoURL || dbUser.photoURL
            }
          },
          { new: true }
        );
      } else {
        console.log('Creating new user');
        // Create new user
        dbUser = new User({
          uid: userId,
          email: user.email,
          name: user.displayName,
          photoURL: user.photoURL,
          communities: [new ObjectId(communityId)]
        });
        await dbUser.save();
      }

      // Update community's member count
      await communityCollection.updateOne(
        { _id: new ObjectId(communityId) },
        { $inc: { members_count: 1 } }
      );

      // Get fresh Discourse user details - use the username from mapping
      // since we might not have the user ID yet
      try {
        const discourseResponse = await axios.get(
          `${community.discourse_url}/u/${mapping.discourseUsername}.json`,
          {
            headers: {
              'Api-Key': process.env.DISCOURSE_API_KEY,
              'Api-Username': 'system'
            }
          }
        );
        
        res.json({
          success: true,
          message: 'Successfully joined community',
          discourseUser: discourseResponse.data.user,
          mapping: {
            discourseUserId: mapping.discourseUserId,
            discourseUsername: mapping.discourseUsername
          },
          user: dbUser
        });
      } catch (discourseError) {
        console.error('Error fetching discourse user details:', discourseError);
        // Even if we can't get Discourse details, we can still return success
        res.json({
          success: true,
          message: 'Successfully joined community',
          mapping: {
            discourseUserId: mapping.discourseUserId,
            discourseUsername: mapping.discourseUsername
          },
          user: dbUser
        });
      }
    } catch (dbError) {
      console.error('Database operation error:', dbError);
      throw dbError;
    }

  } catch (error) {
    console.error('Error in join process:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to join community',
      details: error.response?.data || error
    });
  }
});

module.exports = router;

// Update this route
router.get('/discourse/user/:communityId', async (req, res) => {
  try {
    const { communityId } = req.params;
    const userId = req.query.userId; // Get userId from query params instead of req.user

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Find the mapping
    const mapping = await DiscourseUserMapping.findOne({
      userId,
      communityId: new ObjectId(communityId)
    });

    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: 'User not registered with this community'
      });
    }

    // Get the community to get the Discourse URL
    const { communityCollection } = await getCollections();
    const community = await communityCollection.findOne({
      _id: new ObjectId(communityId)
    });

    if (!community) {
      return res.status(404).json({
        success: false,
        message: 'Community not found'
      });
    }

    // Get fresh Discourse user details
    const discourseResponse = await axios.get(
      `${community.discourse_url}/users/${mapping.discourseUsername}.json`,
      {
        headers: {
          'Api-Key': process.env.DISCOURSE_API_KEY,
          'Api-Username': 'system'
        }
      }
    );

    res.json({
      success: true,
      discourseUser: {
        id: mapping.discourseUserId,
        username: mapping.discourseUsername,
        ...discourseResponse.data.user
      }
    });
  } catch (error) {
    console.error('Error fetching discourse user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching discourse user'
    });
  }
});

module.exports = router;
